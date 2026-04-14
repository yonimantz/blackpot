# Publish without Google Cloud billing (Render + Netlify)

Your app normally uses **Firebase Hosting + Cloud Run**, which requires **billing on the Google Cloud project**. This guide uses **Render** (free tier) for the Python API and **Netlify** (free) for the static frontend—**no Cloud Run**.

Firebase **Auth + Firestore + Storage** stay on Firebase (Spark/free tier is fine for modest use). The backend still needs a **Firebase Admin service account** as JSON (same key you use locally via `GOOGLE_APPLICATION_CREDENTIALS`).

---

## 1. Service account JSON for Render

1. Firebase Console → Project settings → **Service accounts** → **Generate new private key** (JSON file).
2. Open the file, copy **the entire JSON** (one long object).
3. You will paste it into Render as **`FIREBASE_SERVICE_ACCOUNT_JSON`** (see below). **Do not commit** this file to Git.

The backend reads either:

- `GOOGLE_APPLICATION_CREDENTIALS` = path to a file (local dev), or  
- `FIREBASE_SERVICE_ACCOUNT_JSON` = raw JSON string (Render).

---

## 2. Deploy the API on Render

1. Sign up at [render.com](https://render.com).
2. **New** → **Blueprint** → connect [your GitHub repo](https://github.com/yonimantz/blackpot) and select `render.yaml`, **or** **New** → **Web Service** → connect the repo with:
   - **Root**: leave default (repo root).
   - **Runtime**: **Docker**
   - **Dockerfile path**: `backend/Dockerfile`
   - **Docker build context**: `backend`
3. **Instance type**: Free (cold starts after idle are normal).
4. **Environment** (Render dashboard → Environment):
   | Key | Value |
   |-----|--------|
   | `FIREBASE_PROJECT_ID` | `blackpot-c2794` (your project ID) |
   | `DATA_BACKEND` | `firestore` |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | Paste the **full** JSON (Secret) |
   | `ALLOWLIST_EMAILS` | Comma-separated invited emails |
   | `CORS_ORIGINS` | Your Netlify URL only, e.g. `https://your-app.netlify.app` (add more comma-separated if needed) |

   Do **not** set `AUTH_SKIP_ALLOWLIST` in production.

5. Deploy. When it is live, note the URL, e.g. `https://blackpot-api-xxxx.onrender.com`.
6. Test: open `https://YOUR-RENDER-URL.onrender.com/api/health` — you should see `{"status":"ok"}`.

If you change **CORS** after creating the Netlify site, update `CORS_ORIGINS` on Render and **Manual Deploy** → **Clear build cache & deploy** if needed.

---

## 3. Build the frontend with the API URL

On your PC, from `frontend/`:

**PowerShell** (replace the Render URL):

```powershell
$env:VITE_API_BASE = "https://YOUR-SERVICE.onrender.com/api"
$env:VITE_FIREBASE_API_KEY = "…"
$env:VITE_FIREBASE_AUTH_DOMAIN = "…"
$env:VITE_FIREBASE_PROJECT_ID = "…"
$env:VITE_FIREBASE_STORAGE_BUCKET = "…"
$env:VITE_FIREBASE_MESSAGING_SENDER_ID = "…"
$env:VITE_FIREBASE_APP_ID = "…"
npm run build
```

Use the same `VITE_FIREBASE_*` values as in `frontend/.env.local`.  
Alternatively create `frontend/.env.production.local` (gitignored via `*.local`) with those variables and run `npm run build`.

The build output is `frontend/dist/`. It includes `_redirects` for Netlify SPA routing.

---

## 4. Deploy the site on Netlify

1. [Netlify Drop](https://app.netlify.com/drop) or **Add site** → **Deploy manually**.
2. Drag the **`frontend/dist`** folder (the whole folder contents as the publish root).
3. Netlify gives you a URL like `https://random-name.netlify.app`.
4. Go back to Render → set **`CORS_ORIGINS`** to that exact origin (https only, no trailing slash) → redeploy the web service.

---

## 5. Firebase Auth — authorized domain

Firebase Console → **Authentication** → **Settings** → **Authorized domains** → **Add domain** → your Netlify host (e.g. `something.netlify.app`). Add a **custom domain** here too if you add one on Netlify.

---

## 6. Smoke test

1. Open the Netlify URL.
2. Sign in with an **allowed** email.
3. Settings → Gemini key → run a small workflow.

---

## Caveats

- **Free Render** sleeps when idle; the **first request** after sleep can take **~30–60+ seconds**.
- **Gemini usage** is billed to whoever owns each user’s API key (AI Studio), not to Render.
- **Firestore / Storage** quotas still apply under Firebase’s free tier.

---

## Related

- [DEV_TO_PUBLISH.md](DEV_TO_PUBLISH.md) — path with Cloud Run + Firebase Hosting (needs billing).
- [README.md](../README.md) — env vars and project layout.
