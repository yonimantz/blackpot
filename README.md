# Blackpot

A ComfyUI-style node-based workflow editor for image generation and manipulation (React + Vite frontend, FastAPI backend). Runs locally as a single-user app against a local SQLite database.

## Project layout

| Path | Purpose |
|------|---------|
| `frontend/` | React app (Vite, XYFlow canvas) |
| `backend/` | FastAPI API, workflow engine, local SQLite persistence |
| `assets/` | Shared branding assets (e.g. `logo.svg`) |
| `docs/` | [Gemini API keys](docs/GEMINI_API_KEYS.md) |
| `run.bat` | Windows: starts backend and frontend, opens the browser |

The favicon and in-app icon are served from `frontend/public/` (e.g. `blackpot-icon.svg`). Use `assets/logo.svg` as an additional source asset when you need the same mark outside the web build.

## GitHub

This folder is a Git repo on branch **`main`**. Secrets stay out of Git (see `.gitignore`: `backend/.env`, `*.local`, `frontend/dist/`, etc.).

To push to GitHub:

1. Create a **new empty** repository on GitHub (no README, no license) — pick a name such as `blackpot`.
2. From this repo root:

```bat
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

If Git asks for a password, use a [personal access token](https://github.com/settings/tokens) (classic: enable `repo` scope) instead of your account password.

## Quick start

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

Runs at `http://localhost:8000`. Set `GEMINI_API_KEY` in `backend/.env` for AI nodes; see [docs/GEMINI_API_KEYS.md](docs/GEMINI_API_KEYS.md). Per-user API keys can also be saved from the in-app **Settings** page (stored in the local SQLite DB).

### Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`.

### CORS

Set `CORS_ORIGINS` in `backend/.env` to a comma-separated list of allowed origins if you change ports or run the frontend on a different host. Default `*` is fine for local dev.

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
- **Tools**: Resize, Crop, Change Hue, Brightness, Contrast, Blur, Sharpen, Color Overlay, Rotate/Flip
- **Values**: Number, Color Picker, Text, Boolean
- **Read data**: Get Image Size, Get Dominant Colors, Get Pixel Color
- **AI**: Gemini-backed nodes (per-user key in Settings, optional `GEMINI_API_KEY` fallback, or per-node `apiKey`)
