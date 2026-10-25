# Barcode Bin Finder — setup guide (Supabase version)

An Android app (installable web app) that scans barcodes with the live camera and shows the
**Warehouse**, **SKU** and **Product name**. It also searches by SKU or product name.

**Where the data lives:** in a **private** Supabase storage bucket. Only staff accounts that you create can download it.
Nothing about your products is in the app code or on GitHub.
After sign-in, each phone keeps a copy so scanning is instant and works offline.
**Sign out** in Settings removes that copy from the phone.

**How you update it:** sign in as admin, go to **Admin · Update product list**, and upload the new Excel or CSV.
Every phone gets it the next time the app opens. Phones download the file only when it has changed.

---

## 1. Create the Supabase project (5 min)

1. Sign up at supabase.com and click **New project**.
   - Name: `bin-finder`. Set a strong database password and keep it somewhere safe.
   - Region: pick the one closest to Riyadh. Check with Othaim IT if company data has to stay in a specific country.
2. Wait about 2 minutes until the project is ready.

## 2. Run the setup script (1 min)

1. In the left menu, open **SQL Editor > New query**.
2. Open `setup.sql` from this folder, copy all of it, paste, and click **Run**. You should see "Success".
   This creates the private bucket and the rules: staff can read, only admins can upload.

## 3. Lock sign-ups and create accounts (3 min)

1. **Authentication > Sign In / Providers** (on some versions: *Authentication > Settings*):
   turn **OFF "Allow new users to sign up"**. Now only accounts you create can sign in.
2. **Authentication > Users > Add user > Create new user**:
   enter your email and a password, tick **Auto Confirm User**, and click Create.
3. Make yourself admin: in **SQL Editor > New query**, run the following (with your email):
   ```sql
   insert into public.app_admins (user_id)
   select id from auth.users where email = 'your.email@othaim.com'
   on conflict do nothing;
   ```
4. Add each staff member the same way, as in step 2. Don't add them to app_admins.
   Staff without an email can use a made-up one, e.g. `picker01@binfinder.local`, since Auto Confirm skips the email check.
   - **Remove someone:** Authentication > Users > ⋮ > Delete user. Their phone loses access the next time it goes online.
   - **Reset a password:** ⋮ > Reset password, or delete the user and create them again.

## 4. Connect the app to Supabase (1 min)

1. In Supabase, click **Connect** (top bar) or go to **Project Settings > API**. Copy:
   - **Project URL**, e.g. `https://abcdefghijkl.supabase.co`
   - The **anon / publishable** key (a long code). Never use the *service_role / secret* key.
2. Open `config.js` in this folder and paste both between the quotes.

## 5. Put the app online with free GitHub Pages (10 min)

1. Create a free account at github.com.
2. Click **+ > New repository**. Name it `bin-finder`, set it to **Public**, and click **Create repository**.
   This is safe: the repository holds only app code, with no product data.
3. Click **uploading an existing file**. Drag in **everything inside this folder** and click **Commit changes**.
4. Go to **Settings > Pages > Branch: main / (root) > Save**.
5. After about a minute, the app is live at `https://YOUR-USERNAME.github.io/bin-finder/`.

## 6. Upload the product list and install on phones

1. Open the app link in **Chrome** on your phone and sign in with your admin account.
2. In **Admin · Update product list**, choose `Barcode_Database_Ver_001_clean.xlsx` (or any newer export) and check the summary.
   Then tap **Publish to all phones**.
3. Tap **Install app** at the top. If it isn't shown, use Chrome menu **⋮ > Install app**.
4. Staff open the same link, sign in with the account you made for them, and install.

## File rules

- Row 1 must be the headers. Use one row per barcode.
- The app finds columns by their header names: *Barcode / EAN*, *Warehouse / Location*, *SKU / Item code*, *Name / Description*.
  Any other columns, such as Aisle or Supplier, show on the result card automatically.
- In Excel, format the barcode column as **Text**, so long barcodes don't become `6.28E+12`.
  The app warns you before publishing if it sees that.
- Exact duplicate rows are removed automatically when you upload.

## Good to know

- **Free plan:** Supabase pauses a free project after about a week with no activity. Daily use keeps it awake.
  If it pauses, click **Restore** in the dashboard. Phones keep working offline from their saved copy in the meantime.
- **Security:** the anon key in `config.js` is meant to be public. The database rules are what protect the data.
  Without a valid staff login, the file can't be read.
- **APK file:** go to **pwabuilder.com**, paste your app link, and choose **Package for stores > Android**.
  It gives you an `.apk` to share, or an `.aab` for Google Play. It still runs the same online app, so updates keep flowing.
