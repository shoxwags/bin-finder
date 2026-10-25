// ============================================================
//  Barcode Bin Finder — settings
//  This is the only file you need to edit.
// ============================================================

window.BBF_CONFIG = {
  // From Supabase: Project Settings > API (or "Connect" button).
  // "Project URL", e.g. https://abcdefghijkl.supabase.co
  SUPABASE_URL: "",
  // The "anon" / "publishable" key. It is safe to put here: the database rules only let signed-in staff read the data.
  // Never paste the "service_role" / "secret" key here.
  SUPABASE_ANON_KEY: "",

  // Leave these as they are unless you changed them in setup.sql.
  BUCKET: "product-data",
  FILE: "products.csv",

  // Name shown at the top of the app.
  APP_NAME: "Barcode Bin Finder",
};
