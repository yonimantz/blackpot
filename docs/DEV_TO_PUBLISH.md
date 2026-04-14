# From local development to publish

This document describes a practical workflow from coding on your machine to shipping Blackpot with Firebase Hosting, Cloud Run, invite-only auth, and per-user Gemini keys.

---

## 1. Develop locally

- Start the app with **`run.bat`** at the repo root (or run backend and frontend separately).
- **Backend:** `backend/` — FastAPI on port **8000** (`python main.py`; Uvicorn `reload=True` picks up many Python changes automatically).
- **Frontend:** `frontend/` — Vite on port **5173** (`npm run dev`; hot reload for most UI changes).
- After changing **`backend/.env`** or **`frontend/.env.local`**, restart the affected server (or both).

### Behaving like a “real” user

- Leave **`GEMINI_API_KEY`** unset in `backend/.env` so image nodes use keys from **Settings** (per signed-in user), not a shared server key.
- Use **`AUTH_SKIP_ALLOWLIST=1`** only while you are still testing who may sign in. Before publish, replace with a real allowlist (see section 2).

---

## 2. Pre-publish hardening (still on your PC)

- Confirm **Google sign-in**, **API calls with Bearer token**, and **AI runs** work with **only** a key saved in **Settings** (no `GEMINI_API_KEY` in `.env`).
- Run a production build of the frontend once:

  ```bash
  cd frontend
  npm run build
  ```

  Fix any TypeScript or build errors; Hosting will use the same build.

- **Allowlist:** set **`ALLOWLIST_EMAILS`** in `backend/.env` (comma-separated) **or** maintain Firestore document `config/allowed_emails` with field `emails` (array). Then **remove** **`AUTH_SKIP_ALLOWLIST`** so invite-only is enforced.
- **Secrets:** rotate any key that ever appeared in chat, screenshots, or a shared repo. Do not put Gemini keys in the client bundle or in public env vars for end users.

---

## 3. Security and configuration checklist

| Item | Notes |
|------|--------|
| **Gemini** | Per user via **Settings**; optional `GEMINI_API_KEY` only for private dev if you accept shared-key behavior. |
| **Firebase Auth** | Google provider enabled; **Authorized domains** includes `localhost` for dev and your **production domain** for publish. |
| **CORS** | Set **`CORS_ORIGINS`** on the backend to your real Hosting URL(s), not `*`, in production. |
| **Service account** | Local: `GOOGLE_APPLICATION_CREDENTIALS` points to JSON outside the repo. Cloud Run: workload identity / default service account with Firebase Admin access. |
| **Persistence** | **`DATA_BACKEND=firestore`** on Cloud Run for multi-user hosted data; SQLite is for local dev. See [README.md](../README.md). |

---

## 4. Deploy the backend (Cloud Run)

- Copy **`backend/cloud-run-env.yaml.example`** to **`backend/cloud-run-env.yaml`** (gitignored), edit values, then from the repo root run **`powershell -ExecutionPolicy Bypass -File .\scripts\deploy-cloud-run.ps1`** (requires [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and `gcloud auth login`). Or deploy manually from **`backend/`** with the **Dockerfile** (see [README.md](../README.md)).
- Set environment variables on the service, for example:
  - `FIREBASE_PROJECT_ID`
  - `DATA_BACKEND=firestore` (if using Firestore in production)
  - `CORS_ORIGINS` (your Hosting URLs)
  - `ALLOWLIST_EMAILS` or rely on Firestore `config/allowed_emails`
  - Do **not** set `AUTH_SKIP_ALLOWLIST` in production.
  - Omit `GEMINI_API_KEY` if every user must use Settings.
- The Cloud Run **service name** must match **`firebase.json`** → Hosting rewrites → `run.serviceId` (default in repo: `blackpot-api`), or update `firebase.json` to match your service name and region.

---

## 5. Deploy Firebase (rules + hosting)

**Windows (all-in-one):** from the repo root, after `npx -y firebase-tools@latest login` once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-phase3.ps1
```

That deploys Firestore rules, Storage rules, runs `npm run build` in `frontend/`, and deploys Hosting.

**Manual (any OS):**

1. **Firestore & Storage rules** (from repo root, after `firebase login` and `firebase use`):

   ```bash
   npx -y firebase-tools@latest deploy --only firestore:rules,storage
   ```

2. **Hosting** — build, then deploy:

   ```bash
   cd frontend && npm run build && cd ..
   npx -y firebase-tools@latest deploy --only hosting
   ```

   Hosting serves **`frontend/dist`** and rewrites **`/api/**`** to Cloud Run so the browser can call same-origin `/api`.

---

## 6. Smoke test on the live URL

- Open the **hosted** URL (not `localhost`).
- Sign in with an **allowed** Google account.
- **Settings** → paste Gemini key → run a workflow that uses an AI image node → confirm collection/save behavior.

---

## 7. After launch

- **Add invites** by updating **`ALLOWLIST_EMAILS`** (redeploy or use Firestore `config/allowed_emails` per your setup).
- **Shipping updates:** develop locally → `npm run build` → redeploy Hosting; change Python → rebuild/redeploy Cloud Run. There is no automatic push from your laptop to production without running deploy commands.

---

## Related docs

- [GEMINI_API_KEYS.md](GEMINI_API_KEYS.md) — how Gemini keys are resolved (node → Settings → env fallback).
- [README.md](../README.md) — quick start, Firebase env vars, and deploy snippets.
