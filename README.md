# SpotOn

A node-based workflow editor for image generation and manipulation (React + Vite frontend, FastAPI backend). Runs locally as a single-user app against a local SQLite database.

## Project layout

| Path | Purpose |
|------|---------|
| `frontend/` | React app (Vite, XYFlow canvas) |
| `backend/` | FastAPI API, workflow engine, local SQLite persistence |
| `docs/` | [Gemini API keys](docs/GEMINI_API_KEYS.md) |
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

Runs at `http://localhost:8000`. API keys are normally saved from the in-app **Settings** page (stored in the local SQLite DB); a `GEMINI_API_KEY` in `backend/.env` works as a fallback. See [docs/GEMINI_API_KEYS.md](docs/GEMINI_API_KEYS.md).

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
packaging\build.bat
```

That builds the frontend, then packages it with the backend into `packaging\dist\SpotOn\SpotOn.exe` (~320 MB, one folder). The console window it opens is the app's on/off switch — closing it stops the server.

The Remove Background model is not bundled. `rembg` downloads it (~168 MB) into `%USERPROFILE%\.u2net` the first time that node runs, which needs an internet connection but keeps the installer far smaller.

`packaging\SpotOn.ico` is committed. Regenerate it with `python packaging\make_icon.py` only after changing the SVG mark or the colours in that script; it needs the two optional build dependencies.

## Local data

Everything the app writes lives in `%APPDATA%\SpotOn` (never inside the program folder, so an installed copy works from a read-only location):

| Path | Contents |
|------|----------|
| `spoton.db` | Workflows, collection metadata, saved API keys |
| `collection/` | Generated images |
| `uploads/` | Imported source images |
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

- **I/O**: Import Image, Export Image, Preview
- **Tools**: Resize, Crop, Blur, Rotate/Flip, Editor, Compositor, Vignette, Remove Background, Key Color, Stack Images, Divider
- **Values**: Number, Color Picker
- **Text**: Prompt, Combine Prompts, Ref Mapper, Sketch to Final, Studio
- **Read data**: Get Image Size, Get Color Palette
- **AI**: Gemini (Nano Banana), GPT Image, and fal.ai nodes — keys come from Settings, a per-node `apiKey`, or the environment
