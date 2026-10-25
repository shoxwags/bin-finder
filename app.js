/* Barcode Bin Finder — app logic.
   Data flow: staff sign in with Supabase → the product file is downloaded from a private storage bucket
   only when it has changed → kept on the phone (IndexedDB) for fast, offline lookups.
   Admins upload a new Excel/CSV from inside the app; it replaces the file for everyone. */
(() => {
"use strict";
const CFG = window.BBF_CONFIG || {};
const BUCKET = CFG.BUCKET || "product-data", FILE = CFG.FILE || "products.csv";
const $ = id => document.getElementById(id);
const clean = s => String(s ?? "").trim();
const norm = s => clean(s).replace(/\s+/g, "").replace(/\.0+$/, "");
const stripZeros = s => s.replace(/^0+/, "");

let sb = null;            // Supabase client
let user = null;          // signed-in user
let isAdmin = false;
let data = null;          // { headers, rows, version, updatedAt, checkedAt }
let cols = {};            // { code, loc, sku, name }
let byCode = new Map(), bySku = new Map();
let history = [];

if (CFG.APP_NAME) { $("appName").textContent = CFG.APP_NAME; document.title = CFG.APP_NAME; }

/* ---------- local storage (IndexedDB, one record) ---------- */
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("bbf", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", mode); const st = tx.objectStore("kv");
      const req = fn(st);
      tx.oncomplete = () => resolve(req && req.result); tx.onerror = () => reject(tx.error);
    };
  });
}
const saveData = d => idb("readwrite", st => st.put(d, "data")).catch(() => {});
const loadData = () => idb("readonly", st => st.get("data")).catch(() => null);
const clearData = () => idb("readwrite", st => st.delete("data")).catch(() => {});
const pref = { get(k) { try { return JSON.parse(localStorage.getItem("bbf-" + k)); } catch (e) { return null; } },
               set(k, v) { try { v == null ? localStorage.removeItem("bbf-" + k) : localStorage.setItem("bbf-" + k, JSON.stringify(v)); } catch (e) {} } };

/* ---------- CSV / Excel ---------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split("\n")[0];
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (ch !== "\r") f += ch;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const csvCell = v => /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
const toCSV = d => [d.headers, ...d.rows].map(r => r.map(csvCell).join(",")).join("\n");
const cellText = v => typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : clean(v);

function tableToData(table) {
  table = table.filter(r => r.some(c => cellText(c) !== ""));
  if (table.length < 2) throw new Error("The file has no product rows under the header row.");
  const headers = table[0].map(cellText);
  const seen = new Set(), rows = []; let dupes = 0;
  for (const r of table.slice(1)) {
    const row = headers.map((_, i) => cellText(r[i]).replace(/\s+/g, " "));
    const k = row.join("\u0001"); if (seen.has(k)) { dupes++; continue; } seen.add(k); rows.push(row);
  }
  return { headers, rows, dupes };
}

/* ---------- index & columns ---------- */
function findCol(headers, re, avoid) { return headers.findIndex((h, i) => !avoid.includes(i) && re.test(h.toLowerCase())); }
function detectCols(headers, useSaved = true) {
  const c = {};
  const saved = (useSaved && pref.get("cols-" + headers.join("|"))) || {};
  c.code = saved.code ?? findCol(headers, /barcode|ean|upc|gtin|باركود/, []); if (c.code < 0) c.code = 0;
  c.loc = saved.loc ?? findCol(headers, /warehouse|^wh$|location|^loc|bin|slot|shelf|مستودع|موقع/, [c.code]);
  if (c.loc < 0) c.loc = c.code === 0 ? 1 : 0;
  c.sku = findCol(headers, /sku|item ?code|item ?no|item ?id|article/, [c.code, c.loc]);
  c.name = findCol(headers, /name|desc|product|اسم|وصف/, [c.code, c.loc, c.sku]);
  return c;
}
function buildIndex() {
  byCode = new Map(); bySku = new Map();
  if (!data) { $("count").textContent = "0"; renderSync(); return; }
  cols = detectCols(data.headers);
  const add = (m, k, r) => { if (!k) return; const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); };
  let n = 0;
  for (const r of data.rows) {
    const c = norm(r[cols.code]); if (!c) continue; n++;
    add(byCode, c, r); add(byCode, "z:" + stripZeros(c), r);
    if (cols.sku >= 0) add(bySku, norm(r[cols.sku]), r);
  }
  $("count").textContent = n.toLocaleString("en-US");
  for (const [id, val] of [["colCode", cols.code], ["colLoc", cols.loc]]) {
    const sel = $(id); sel.innerHTML = "";
    data.headers.forEach((h, i) => { const o = document.createElement("option"); o.value = i; o.textContent = h || "Column " + (i + 1); sel.appendChild(o); });
    sel.value = val;
  }
  renderSync();
}
["colCode", "colLoc"].forEach(id => $(id).addEventListener("change", () => {
  pref.set("cols-" + data.headers.join("|"), { code: +$("colCode").value, loc: +$("colLoc").value });
  buildIndex();
}));

/* ---------- views ---------- */
function view(name) {
  $("loginView").hidden = name !== "login"; $("appView").hidden = name !== "app"; $("setupView").hidden = name !== "setup";
}
function status(t) { $("status").textContent = t; }

/* ---------- sync with Supabase Storage ---------- */
let syncing = false, syncNote = "";
function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function renderSync() {
  const el = $("syncLine"); el.textContent = "";
  if ($("appView").hidden) { el.textContent = $("loginView").hidden ? "" : "Sign in to load products"; return; }
  const dot = document.createElement("span"); dot.className = "dot" + (navigator.onLine ? "" : " off");
  let t;
  if (syncing) t = "Checking for a newer product list…";
  else if (!data) t = "No product list on this phone yet";
  else t = "Product list from " + fmt(data.updatedAt) + (navigator.onLine ? "" : " · offline");
  el.append(dot, document.createTextNode(t));
  if (syncNote && !syncing) el.append(document.createElement("br"), document.createTextNode(syncNote));
}
async function remoteInfo() {
  const { data: list, error } = await sb.storage.from(BUCKET).list("", { search: FILE, limit: 20 });
  if (error) throw error;
  return (list || []).find(o => o.name === FILE) || null;
}
const versionOf = info => (info.updated_at || "") + "|" + ((info.metadata && info.metadata.size) || "");

async function syncData(manual) {
  if (!user) return;
  if (!navigator.onLine) { if (manual) status(data ? "You're offline. Using the list saved on this phone." : "You're offline. Connect once to download the product list."); return; }
  syncing = true; syncNote = ""; renderSync(); $("refreshBtn").disabled = true;
  try {
    const info = await remoteInfo();
    if (!info) {
      syncNote = isAdmin ? "No product list uploaded yet. Upload one in the Admin section below." : "No product list uploaded yet. Ask your admin to upload one.";
      return;
    }
    const version = versionOf(info);
    if (data && data.version === version) { if (manual) status("You already have the latest list."); return; }
    const { data: blob, error } = await sb.storage.from(BUCKET).download(FILE);
    if (error) throw error;
    const t = tableToData(parseCSV(await blob.text()));
    data = { headers: t.headers, rows: t.rows, version, updatedAt: Date.parse(info.updated_at) || Date.now() };
    await saveData(data); buildIndex();
    status(`Product list updated: ${$("count").textContent} barcodes.`);
  } catch (e) {
    syncNote = "Couldn't check for updates (" + (e.message || "network error") + ")." + (data ? " Using the list saved on this phone." : "");
    if (/jwt|token|auth|401|403/i.test(e.message || "") && navigator.onLine) { await sessionLost(); return; }
  } finally { syncing = false; $("refreshBtn").disabled = false; renderSync(); }
}
$("refreshBtn").addEventListener("click", () => syncData(true));
window.addEventListener("online", () => { renderSync(); syncData(false); });
window.addEventListener("offline", renderSync);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && user) syncData(false); });

/* ---------- sign-in ---------- */
async function afterSignIn(u) {
  user = u; pref.set("user", u.email);
  $("userLine").textContent = u.email;
  view("app"); renderSync();
  try {
    const { data: row } = await sb.from("app_admins").select("user_id").eq("user_id", u.id).maybeSingle();
    isAdmin = !!row;
  } catch (e) { isAdmin = false; }
  $("adminPanel").hidden = !isAdmin;
  await syncData(false);
}
async function sessionLost() {
  user = null; isAdmin = false; data = null; $("adminPanel").hidden = true; syncNote = ""; await clearData(); buildIndex();
  $("loginStatus").textContent = "Your sign-in has expired or was removed. Please sign in again.";
  view("login"); renderSync();
}
$("loginView").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("loginBtn"); btn.disabled = true; $("loginStatus").className = "status"; $("loginStatus").textContent = "Signing in…";
  try {
    const { data: res, error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    if (error) throw error;
    $("password").value = ""; $("loginStatus").textContent = "";
    await afterSignIn(res.user);
  } catch (err) {
    $("loginStatus").className = "status err";
    $("loginStatus").textContent = !navigator.onLine ? "You're offline. Connect to the internet to sign in."
      : /invalid/i.test(err.message || "") ? "Email or password is wrong. Check them, or ask your admin to reset your password."
      : "Couldn't sign in: " + (err.message || "unknown error");
  } finally { btn.disabled = false; }
});
$("signOutBtn").addEventListener("click", async () => {
  if (running) stopScan();
  try { await sb.auth.signOut(); } catch (e) {}
  pref.set("user", null); await sessionLost(); $("loginStatus").textContent = "Signed out. The product list was removed from this phone.";
});

/* ---------- admin upload ---------- */
let pending = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/xlsx.min.js"; s.onload = res; s.onerror = () => rej(new Error("Excel reader didn't load")); document.head.appendChild(s); });
}
$("uploadFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const st = $("adminStatus"); st.className = "status"; st.textContent = "Reading " + f.name + "…"; $("confirmBox").hidden = true;
  try {
    let table;
    if (/\.(csv|txt)$/i.test(f.name)) table = parseCSV(await f.text());
    else {
      await loadXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    }
    const t = tableToData(table);
    const c = detectCols(t.headers, false);
    let sci = 0; for (const r of t.rows) { r[c.code] = r[c.code].replace(/\s+/g, ""); if (/e\+/i.test(r[c.code])) sci++; }
    pending = { t, c, name: f.name };
    const parts = [`${f.name}: ${t.rows.length.toLocaleString("en-US")} rows`];
    if (t.dupes) parts.push(`${t.dupes.toLocaleString("en-US")} exact duplicates removed`);
    $("confirmText").textContent = parts.join(", ") + `. Barcode column: "${t.headers[c.code]}". Big text: "${t.headers[c.loc]}". Columns: ${t.headers.join(", ")}.`
      + (sci ? ` Warning: ${sci} barcodes look like 6.28E+12. Format the barcode column as Text in Excel and save again.` : "");
    $("confirmBox").hidden = false; st.textContent = "";
  } catch (err) { st.className = "status err"; st.textContent = "Couldn't read that file: " + (err.message || err) + ". Save it as .xlsx or .csv and try again."; }
});
$("cancelUpload").addEventListener("click", () => { pending = null; $("confirmBox").hidden = true; });
$("confirmUpload").addEventListener("click", async () => {
  if (!pending) return;
  const st = $("adminStatus"); st.className = "status"; st.textContent = "Uploading…"; $("confirmUpload").disabled = true;
  try {
    const blob = new Blob(["﻿" + toCSV(pending.t)], { type: "text/csv" });
    const { error } = await sb.storage.from(BUCKET).upload(FILE, blob, { upsert: true, contentType: "text/csv; charset=utf-8", cacheControl: "0" });
    if (error) throw error;
    const info = await remoteInfo().catch(() => null);
    data = { headers: pending.t.headers, rows: pending.t.rows, version: info ? versionOf(info) : "", updatedAt: info ? Date.parse(info.updated_at) : Date.now() };
    syncNote = ""; await saveData(data); buildIndex();
    st.textContent = `Published ${pending.t.rows.length.toLocaleString("en-US")} rows. Phones get it the next time they open the app.`;
    $("confirmBox").hidden = true; pending = null;
  } catch (err) {
    st.className = "status err";
    st.textContent = /row-level|policy|403|unauthorized/i.test(err.message || "") ? "Upload refused: this account isn't set as an admin in Supabase (app_admins table)." : "Upload failed: " + (err.message || err);
  } finally { $("confirmUpload").disabled = false; }
});

/* ---------- start ---------- */
async function boot() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) { view("setup"); $("syncLine").textContent = ""; return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const remembered = pref.get("user");
  if (remembered) $("email").value = remembered;
  const cached = remembered ? await loadData() : null;
  if (cached && cached.rows) {                 // show saved list at once, even offline
    data = cached; user = { email: remembered }; $("userLine").textContent = remembered; view("app"); buildIndex();
  }
  let session = null;
  try { const r = await sb.auth.getSession(); session = r.data && r.data.session; } catch (e) {}
  if (session) { await afterSignIn(session.user); return; }
  if (cached && !navigator.onLine) return;     // offline: keep working from the saved list
  if (cached) { await sessionLost(); return; } // online but session gone
  view("login"); renderSync();
}

/* ---------- search & results ---------- */
function search(raw, fromCamera) {
  const q = clean(raw); if (!q) return { kind: "none", rows: [] };
  const n = norm(q);
  let rows = byCode.get(n) || byCode.get("z:" + stripZeros(n));
  if (rows) return { kind: "barcode", rows };
  if (fromCamera) return { kind: "none", rows: [] };
  if (cols.sku >= 0 && (rows = bySku.get(n))) return { kind: "SKU", rows };
  if (cols.name >= 0 && q.length >= 3 && /[^\d\s]/.test(q)) {
    const lq = q.toLowerCase(), out = [];
    for (const r of data.rows) { if (r[cols.name].toLowerCase().includes(lq)) { out.push(r); if (out.length > 25) break; } }
    if (out.length) return { kind: "name", rows: out };
  }
  return { kind: "none", rows: [] };
}
function card(r) {
  const box = document.createElement("div"); box.className = "result found fresh";
  const eb = document.createElement("div"); eb.className = "eyebrow"; eb.textContent = data.headers[cols.loc] || "Location";
  const loc = document.createElement("div"); loc.className = "loc"; loc.textContent = r[cols.loc] || "(blank)";
  const dl = document.createElement("dl"); dl.className = "fields";
  data.headers.forEach((h, i) => {
    if (i === cols.loc) return;
    const dt = document.createElement("dt"); dt.textContent = h || "Column " + (i + 1);
    const dd = document.createElement("dd"); dd.textContent = r[i] || "—";
    if (i === cols.code || i === cols.sku) dd.className = "mono";
    dl.append(dt, dd);
  });
  box.append(eb, loc, dl);
  return box;
}
function show(raw, fromCamera) {
  const res = search(raw, fromCamera);
  const wrap = $("results"); wrap.innerHTML = ""; wrap.classList.toggle("many", res.rows.length > 1);
  if (!res.rows.length) {
    const box = document.createElement("div"); box.className = "result miss";
    const eb = document.createElement("div"); eb.className = "eyebrow"; eb.textContent = "Result";
    const loc = document.createElement("div"); loc.className = "loc"; loc.textContent = "Not in list";
    const code = document.createElement("div"); code.className = "code"; code.textContent = clean(raw);
    box.append(eb, loc, code); wrap.appendChild(box);
    feedback(false);
  } else {
    if (res.rows.length > 1) {
      const h = document.createElement("div"); h.className = "results-head";
      const more = res.rows.length > 25;
      h.textContent = res.kind === "barcode" ? `This barcode is on ${res.rows.length} rows in the list.`
        : `${more ? "First 25" : res.rows.length} matches by ${res.kind}${more ? ". Type more of the name to narrow it down." : "."}`;
      wrap.appendChild(h);
    }
    res.rows.slice(0, 25).forEach(r => wrap.appendChild(card(r)));
    feedback(true);
  }
  const locs = [...new Set(res.rows.map(r => r[cols.loc] || "(blank)"))];
  history.unshift({ q: clean(raw), l: res.rows.length ? (locs.length > 3 ? locs.slice(0, 3).join(", ") + "…" : locs.join(", ")) : null });
  history = history.slice(0, 20);
  const ul = $("history"); ul.innerHTML = "";
  for (const h of history) {
    const li = document.createElement("li");
    const a = document.createElement("span"); a.className = "c"; a.textContent = h.q;
    const b = document.createElement("span"); b.className = "l" + (h.l ? "" : " no"); b.textContent = h.l || "Not in list";
    li.append(a, b); ul.appendChild(li);
  }
}
$("manual").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); show(e.target.value, false); e.target.select(); } });

/* ---------- feedback: beep + vibrate ---------- */
let audio = null;
function feedback(ok) {
  try { navigator.vibrate && navigator.vibrate(ok ? 60 : [80, 60, 80]); } catch (e) {}
  if (!audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.25));
  } catch (e) {}
}

/* ---------- live camera scanning ---------- */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
let stream = null, running = false, detector = null, zx = null, wakeLock = null, lastCode = "", lastAt = 0;
const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d", { willReadFrequently: true });

async function makeDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const sup = await BarcodeDetector.getSupportedFormats();
      const f = FORMATS.filter(x => sup.includes(x));
      if (f.length) return { kind: "native", d: new BarcodeDetector({ formats: f }) };
    } catch (e) {}
  }
  if (window.ZXing) {
    const Z = window.ZXing, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A,
      Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const r = new Z.MultiFormatReader(); r.setHints(hints);
    return { kind: "zxing", d: r };
  }
  return null;
}
async function detectFrame(video) {
  if (detector.kind === "native") {
    const found = await detector.d.detect(video);
    return found.length ? found[0].rawValue : null;
  }
  const Z = window.ZXing, vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
  const cw = Math.round(vw * 0.8), ch = Math.round(vh * 0.56), sx = (vw - cw) / 2, sy = (vh - ch) / 2;
  const scale = Math.min(1, 900 / cw);
  canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
  ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  try {
    const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
    return detector.d.decode(bmp).getText();
  } catch (e) { return null; } finally { detector.d.reset && detector.d.reset(); }
}
async function loop() {
  const video = $("video");
  while (running) {
    if (video.readyState >= 2) {
      let code = null;
      try { code = await detectFrame(video); } catch (e) {}
      if (code) {
        const now = Date.now();
        const isNew = code !== lastCode || now - lastAt > 2500; // same code held in view is not repeated
        lastAt = now;
        if (isNew) {
          lastCode = code;
          status("Read: " + code);
          show(code, true);
          $("scanner").classList.add("hit"); setTimeout(() => $("scanner").classList.remove("hit"), 400);
          await new Promise(r => setTimeout(r, 900));
        }
      }
    }
    await new Promise(r => setTimeout(r, detector && detector.kind === "native" ? 120 : 200));
  }
}
async function startScan() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume && audio.resume(); } catch (e) {}
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status("This browser can't open the live camera here. Use \"Take a photo instead\", or open the app from its https link."); return;
  }
  detector = detector || await makeDetector();
  if (!detector) { status("The barcode reader didn't load. Check your connection once, then try again."); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, focusMode: "continuous" } });
  } catch (e) {
    status(e.name === "NotAllowedError" ? "Camera permission was refused. Allow the camera for this app in your phone settings, then try again."
      : "Couldn't open the camera: " + (e.message || e.name)); return;
  }
  const video = $("video"); video.srcObject = stream; await video.play().catch(() => {});
  $("scanner").hidden = false; $("startBtn").hidden = true;
  status("Point the camera at a barcode. It keeps scanning until you press Stop.");
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  $("torchBtn").hidden = !caps.torch; $("torchBtn").setAttribute("aria-pressed", "false");
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) {}
  running = true; loop();
}
function stopScan() {
  running = false;
  if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
  $("scanner").hidden = true; $("startBtn").hidden = false;
  try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null;
}
$("startBtn").addEventListener("click", startScan);
$("stopBtn").addEventListener("click", stopScan);
$("torchBtn").addEventListener("click", async () => {
  const track = stream && stream.getVideoTracks()[0]; if (!track) return;
  const on = $("torchBtn").getAttribute("aria-pressed") !== "true";
  try { await track.applyConstraints({ advanced: [{ torch: on }] }); $("torchBtn").setAttribute("aria-pressed", String(on)); } catch (e) {}
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && running) stopScan(); });

/* ---------- photo fallback ---------- */
$("photo").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  status("Reading barcode…");
  try {
    const bmp = await createImageBitmap(f);
    let code = null;
    detector = detector || await makeDetector();
    if (detector && detector.kind === "native") { const r = await detector.d.detect(bmp); code = r.length ? r[0].rawValue : null; }
    if (!code && window.ZXing) {
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      canvas.width = Math.round(bmp.width * s); canvas.height = Math.round(bmp.height * s);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const Z = window.ZXing, r = new Z.MultiFormatReader(), h = new Map(); h.set(Z.DecodeHintType.TRY_HARDER, true); r.setHints(h);
      try { code = r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)))).getText(); } catch (err) {}
    }
    if (code) { status("Read: " + code); show(code, true); }
    else status("Couldn't read a barcode in that photo. Move closer, keep it flat and in focus, or type the number.");
  } catch (err) { status("Couldn't open that photo."); }
  e.target.value = "";
});

/* ---------- install + offline ---------- */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
$("installBtn").addEventListener("click", async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("installBtn").hidden = true; });
window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

boot();
})();
