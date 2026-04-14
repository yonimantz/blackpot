# Blackpot

A ComfyUI-style node-based workflow editor for image generation and manipulation (React + Vite frontend, FastAPI backend).

## Project layout

| Path | Purpose |
|------|---------|
| `frontend/` | React app (Vite, XYFlow canvas) |
| `backend/` | FastAPI API, workflow engine, persistence (SQLite or Firestore) |
| `assets/` | Shared branding assets (e.g. `logo.svg`) |
| `docs/` | [Publishing plan](docs/PUBLISHING_PLAN.md) (phased timeline), [dev → publish](docs/DEV_TO_PUBLISH.md), [Gemini keys](docs/GEMINI_API_KEYS.md) |
| `firebase.json` | Firebase Hosting + rules (production deploy) |
| `run.bat` | Windows: starts backend and frontend, opens the browser |

The favicon and in-app icon are served from `frontend/public/` (e.g. `blackpot-icon.svg`). Use `assets/logo.svg` as an additional source asset when you need the same mark outside the web build.

## Quick start (local, no Firebase)

### Windows (both servers)

Double-click `run.bat`, or from the repo root:

```bat
run.bat
```

### Backend (Python)

```bash
cd backend
cp .env.example .env   # Unix — on Windows: copy .env.example .env
pip install -r requirements.txt
python main.py
```

Runs at `http://localhost:8000`. Set `GEMINI_API_KEY` in `backend/.env` for AI nodes; see [docs/GEMINI_API_KEYS.md](docs/GEMINI_API_KEYS.md).

Leave `FIREBASE_PROJECT_ID` unset so the API does **not** require sign-in (SQLite keeps working as a single-user/dev setup).

### Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`.

Without `VITE_FIREBASE_*` variables, the UI does not show a login gate.

## Firebase Auth and invite-only access

When you are ready to publish for **specific people**:

1. Create a Firebase project and enable **Authentication** (**Email/Password** and/or **Google**), **Firestore**, **Storage**, and **Hosting**.
2. **Backend** (`backend/.env` or Cloud Run env):
   - `FIREBASE_PROJECT_ID` — enables JWT verification on all protected API routes.
   - `ALLOWLIST_EMAILS` — comma-separated list of allowed account emails (Google or email/password sign-in).
   - Or create Firestore document `config/allowed_emails` with field `emails` (array of strings). If neither is set, **no one** is allowed unless you set `AUTH_SKIP_ALLOWLIST=1` (development only).
   - `GOOGLE_APPLICATION_CREDENTIALS` — path to a service account JSON locally; on Cloud Run use the default service account with Firebase Admin permissions.
3. **Frontend** — copy `frontend/.env.example` to `frontend/.env.local` and fill in the Firebase web app values from the Firebase console (`VITE_FIREBASE_*`).
4. Users sign in with **email/password** (create account on the login screen) or **Google**, then open **Settings** and paste a [Google AI Studio](https://aistudio.google.com/apikey) API key. Keys are stored server-side (Firestore `userSecrets/{uid}` or SQLite `user_secrets` when testing with Auth locally).

### Persistence backends

| `DATA_BACKEND` | Use case |
|----------------|----------|
| `sqlite` (default) | Local dev; optional `owner_uid` columns when Firebase Auth is enabled |
| `firestore` | Production on Cloud Run; requires `FIREBASE_PROJECT_ID` and Firebase Auth |

### CORS

Set `CORS_ORIGINS` to a comma-separated list of allowed origins (e.g. `https://your-app.web.app`). Default `*` is only for convenience in local development.

## Production deploy (Firebase Hosting + Cloud Run)

**Windows scripts** (after `npx -y firebase-tools@latest login` and installing [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)):

1. Copy `backend/cloud-run-env.yaml.example` → `backend/cloud-run-env.yaml` and edit (gitignored).
2. `powershell -ExecutionPolicy Bypass -File .\scripts\deploy-cloud-run.ps1` — deploys the API to Cloud Run.
3. `powershell -ExecutionPolicy Bypass -File .\scripts\deploy-phase3.ps1` — rules + frontend build + Hosting.

**Manual steps:**

1. **Cloud Run** — build and deploy the backend from `backend/` (Dockerfile included):

   ```bash
   cd backend
   # Set env: FIREBASE_PROJECT_ID, DATA_BACKEND=firestore, CORS_ORIGINS, ALLOWLIST_EMAILS, etc.
   gcloud run deploy blackpot-api --source . --region us-central1
   ```

   The service id must match `firebase.json` → `hosting.rewrites[0].run.serviceId` (`blackpot-api`), or edit `firebase.json` to your service name.

2. **Firestore & Storage rules** — from the repo root:

   ```bash
   npx -y firebase-tools@latest login
   npx -y firebase-tools@latest use --add YOUR_PROJECT_ID
   npx -y firebase-tools@latest deploy --only firestore:rules,storage
   ```

3. **Hosting** — build the frontend, then deploy:

   ```bash
   cd frontend && npm run build && cd ..
   npx -y firebase-tools@latest deploy --only hosting
   ```

   Hosting serves `frontend/dist` and rewrites `/api/**` to your Cloud Run URL (same-origin `/api` in the browser).

## Usage

1. **Add nodes** — Drag from the left palette onto the canvas.
2. **Connect** — Drag from an output handle to a compatible input.
3. **Configure** — Select a node to edit properties in the inspector.
4. **Run** — Use the run control at the bottom to execute the workflow.

## Keyboard shortcuts

- **M** — Bypass all selected nodes; **Alt+M** — clear bypass on all selected nodes
- **Delete / Backspace** — Remove the selected node

## Node types

- **I/O**: Import Image, Export Image, Preview
- **Tools**: Resize, Crop, Change Hue, Set Alpha, Brightness, Contrast, Blur, Sharpen, Color Overlay, Rotate/Flip
- **Values**: Number, Color Picker, Text, Boolean
- **Read data**: Get Image Size, Get Dominant Colors, Get Pixel Color
- **AI**: Gemini-backed nodes (per-user key in Settings, optional `GEMINI_API_KEY` fallback, or per-node `apiKey`)
