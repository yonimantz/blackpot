# SpotOn

A node-based workflow editor for image generation and manipulation (React + Vite frontend, FastAPI backend). Runs locally as a single-user app against a local SQLite database.

## Project layout

| Path | Purpose |
|------|---------|
| `frontend/` | React app (Vite, XYFlow canvas) |
| `backend/` | FastAPI API, workflow engine, local SQLite persistence |
| `docs/` | [Installing](docs/INSTALL.md), [fal.ai API keys](docs/FAL_API_KEYS.md) |
| `packaging/` | PyInstaller spec, Inno Setup script, icon, `build.bat` |
| `run.bat` | Windows: starts backend and frontend, opens the browser |

Branding assets live in `frontend/`: `src/assets/SpotOn-Icon.svg` is inlined into the workflow icons, and `public/SpotOn-Icon.svg` / `public/SpotOn-Logo.svg` are served as the favicon and the title-bar logo.

## Quick start

### Windows (both servers)

Double-click `run.bat`, or from the repo root:

```bat
run.bat
```

This is the development setup: the backend serves the API on port 8000 and Vite serves the UI on 5173 with hot reload.

### Single-port mode

The way an installed copy runs. The backend serves the built UI itself, so there is one process on one port:

```bat
cd frontend && npm run build
cd ..\backend && python main.py --desktop
```

It picks port 8000, or the next free port if that one is taken, then opens your browser. Launching it again while it is already running just opens a tab pointing at the existing server instead of starting a second one. `SPOTON_PORT` changes which port it tries first.

### Backend (Python)

```bash
cd backend
copy .env.example .env   # Windows — on Unix: cp .env.example .env
pip install -r requirements.txt
python main.py
```

Runs at `http://localhost:8000`. The fal.ai key is normally saved from the in-app **Settings** page (stored in the local SQLite DB); a `FAL_KEY` in `backend/.env` works as a fallback. See [docs/FAL_API_KEYS.md](docs/FAL_API_KEYS.md).

### Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`, proxying `/api` to the backend.

### CORS

Set `CORS_ORIGINS` in `backend/.env` to a comma-separated list of allowed origins if you change ports or run the frontend on a different host. The default `*` is fine for local use.

## Building the Windows app

```bat
pip install -r packaging\requirements-build.txt
winget install --id JRSoftware.InnoSetup
packaging\build.bat
```

Three steps: build the frontend, package it with the backend into `packaging\dist\SpotOn\SpotOn.exe` (~83 MB, one folder), then wrap that folder into `packaging\SpotOn-Setup.exe` (~29 MB) — the single file you hand to someone else. If Inno Setup is missing, the build stops after the app folder and says so, which is enough for testing locally.

The console window the app opens is its on/off switch — closing it stops the server.

The installer is per-user: it needs no administrator rights, installs into `%LOCALAPPDATA%\Programs\SpotOn`, and an uninstall deliberately leaves `%APPDATA%\SpotOn` untouched so workflows and images survive it. Reinstalling over an existing copy upgrades it in place, which depends on `AppId` in `packaging\spoton.iss` never changing. Before handing out a new build, bump `backend\version.py` and the matching `version` in `frontend\package.json` — the build refuses to run while those two disagree, and everything else (the installer, `/api/health`, the Settings page) reads the version from there. The previous installer is kept in `packaging\archive\` for rollback. [docs/INSTALL.md](docs/INSTALL.md) is written for the recipient, so send it along.

It is not code-signed, so Windows shows a SmartScreen "unknown publisher" warning that the recipient has to click through. Silencing that needs a paid certificate.

`packaging\SpotOn.ico` is committed. Regenerate it with `python packaging\make_icon.py` only after changing the SVG mark or the colours in that script; it needs the two optional build dependencies.

## Local data

Everything the app writes lives in `%APPDATA%\SpotOn` (never inside the program folder, so an installed copy works from a read-only location):

| Path | Contents |
|------|----------|
| `spoton.db` | Workflows, collection metadata, saved API keys |
| `collection/` | Generated images |
| `uploads/` | Imported source images |
| `models/` | Generated 3D meshes (GLB) |
| `exports/` | Default destination for the Export node |
| `.env` | Optional keys for an installed copy (a dev checkout uses `backend/.env` instead) |

Set `SPOTON_DATA_DIR` to put that tree somewhere else — useful for a portable copy or for testing against throwaway data. `backend/paths.py` resolves all of it, and moves data from older layouts (`backend/spoton.db`, `blackpot.db`, `weavy.db`, and the sibling `collection/`, `uploads/`, `exports/` folders) on first run.

## Usage

1. **Add nodes** — Drag from the left palette onto the canvas.
2. **Connect** — Drag from an output handle to a compatible input.
3. **Configure** — Select a node to edit properties in the inspector.
4. **Run** — Use the run control at the bottom to execute the workflow.

## Keyboard shortcuts

- **M** — Bypass all selected nodes; **Alt+M** — clear bypass on all selected nodes
- **Delete / Backspace** — Remove the selected node

## Node types

- **I/O**: Import Image, Export Image, Export 3D, Preview, Preview 3D (orbitable mesh view with a grid floor, adjustable key/fill light and shadow, and a corner axis navigator; passes the mesh through to Export 3D)
- **Tools**: Resize, Crop, Blur, Rotate/Flip, Editor, Compositor, Vignette, Remove Background, Key Color, Stack Images, Divider
- **Values**: Number, Color Picker
- **Text**: Prompt, Combine Prompts, Ref Mapper, Sketch to Final, Studio
- **Read data**: Get Image Size, Get Color Palette
- **AI**: FAL AI (image generation), Image SCF Prompt (image → prompt), Image to 3D, and Upscaler (image → larger image, Real-ESRGAN or Clarity) — every AI call goes to fal.ai, with the key from Settings, a per-node `apiKey`, or `FAL_KEY` in the environment. Remove Background is a fal call too, so it needs the key and an internet connection.
