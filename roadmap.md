# SpotOn Roadmap

How to use this file:

- **What Next** — active and queued phases, in order. Each one is a brief.
- **Adjustments** — small fixes and polish. One line each, no full brief needed.
- **Notes** — durable facts we keep forgetting.
- **Backlog** — real work, not scheduled yet.
- **Ideas** — unfiltered, no commitment.
- **Archive** — shipped phases, newest first, with the date and what actually changed.

Brief format: **Goal**, **Why**, **Scope**, **Open**, **Done when**.

---

## What Next

### P4 · Update system · size: M · status: in progress

**Goal** One click to update, zero risk to anyone's work.

**Already true, don't rebuild** `spoton.iss` has a stable `AppId` so installs upgrade
in place, and all user data lives in `%APPDATA%\SpotOn` — untouched by install and
uninstall.

**Scope — buildable now, no server needed**

- Single source of truth for the version (today: only `spoton.iss` says `1.0.0`,
  `package.json` says `0.0.0`, and the app can't report its own version)
- `schema_migrations` table with an ordered migration list, replacing ad-hoc column adds
- Automatic backup of `spoton.db` (not the collection — see Notes) before a new
  version's first run
- `AppMutex` in the iss so locked files can't break an upgrade

**Scope — blocked on somewhere to host `latest.json` and the installer over HTTPS**

- `latest.json` manifest (version, URL, sha256, notes, `min_supported_version`)
- In-app check on launch → banner → download → launch installer → app closes itself
- Keep `archive/` of old installers for rollback

**Open** Code signing — every unsigned release triggers SmartScreen. Live with it, or
~$200-400/yr for a cert? Also: where does `latest.json` live once we get there — the
network share, or a hosted git forge?

**Done when** A coworker updates without being told how, and a bad release can be
rolled back.

---

### P5 · macOS · size: L · status: later

**Goal** Same app, same updater, on Mac.

**Notes** PyInstaller cannot cross-compile — needs a Mac or a macOS CI runner. Set up
GitHub Actions for both platforms so builds come from one tagged commit. Apple Silicon
first. Unsigned `.app` means right-click-Open the first time; proper fix is Apple
Developer ($99/yr) + Developer ID + notarization. `console=True` currently means a
Terminal window — needs a real `.app` bundle. Data paths already handle macOS.
P1 already dropped `onnxruntime`, which was the riskiest arm64 dependency.

---

### P6 · 3D, first slice · size: M · status: next

**Goal** One image in, a GLB out that you can rotate, export, and open in Blender.

**Why** SpotOn already makes the exact input image-to-3D wants — FAL AI → Remove
Background → Crop is the ideal pre-processor, and today that hand-off happens in
someone's browser tabs. fal hosts 62 3D models including Tripo, Meshy, Hunyuan and
Trellis, so this is new node plumbing, not a new vendor.

**Already true, don't rebuild** `fal_common.py` handles key resolution, client,
upload and error shaping. `client.subscribe()` already polls fal's queue, so a
3-minute job needs no new job system. Per-key spend attribution (see Notes) covers
3D cost exactly like image cost.

**Scope**

- `model3d` port type in `nodeTypes.ts`, plus `PORT_TYPE_COLORS` and `canConnect`
- One node, `imageTo3d`, with a model dropdown holding two entries only: one cheap
  and fast, one good — `hunyuan-3d/v3.1/rapid/image-to-3d` and
  `tripo3d/h3.1/image-to-3d`
- Mesh travels the wire as `{ url, format }`, never base64: a 30 MB GLB inlined into
  `_result` would be written into `spoton.db` on every save
- `MODELS_DIR` in `paths.py`, and download the GLB on completion — fal output URLs
  are not permanent, and a saved workflow has to still open next month
- New result parser: these endpoints return `model_mesh: { url, ... }`, not
  `images: []`. It must not reach `_save_image_to_collection`, which runs PIL and
  will throw on GLB bytes — so a new engine type set, not `AI_TYPES`
- Add `model` to the bypass pass-through list beside `image`/`text`/`value`
- Node preview uses the thumbnail these models return, so the existing `<img>` path
  does the work
- `export3d` node writing GLB to `EXPORT_DIR`, mirroring `exportImage`

**Open** The viewer. Thumbnail-only is free, but you can't inspect what you made.
`@google/model-viewer` is ~350 KB gzipped for orbit controls in about 30 lines;
three.js is heavier but P7 needs it anyway. P1 fought the installer down to 28.5 MB
— which do we pay for?

**Settled** Meshes do belong in Collection: it is the only place every generation can
be found again and downloaded, and a mesh that lives only inside the workflow that
made it is lost the moment that graph moves on. A mesh row carries `kind='model3d'`,
its GLB as the item file, and the generator's render as `thumb_filename` — the tile
shows the same picture the node does, so Collection stays a flat grid with no WebGL
in it. The GLB is copied in rather than referenced in `MODELS_DIR`, so deleting a
collection item can't strip the mesh out of a saved workflow.

**Done when** Someone turns a product shot into a mesh and opens the exported GLB in
Blender without leaving SpotOn.

---

### P7 · 3D, closing the loop · size: M · status: later

**Goal** Renders of the mesh go back into the image graph.

**Why** Render 3D is what makes 3D worth having in an image tool. Generate a
character once, convert it, render eight angles, feed them back as reference images.
That's the consistent-character problem, solved as a graph.

**Scope**

- `render3d` — mesh in, image out, with camera angle, lighting and background.
  Client-side three.js to an offscreen canvas, the way Crop and Editor already bake
  in the browser. No fal model does this.
- `textTo3d` — wires the existing Prompt, Studio and RefMapper nodes into the 3D
  pipeline for the price of one node
- One 3D-to-3D operation to prove that chain: `tripo3d/tripo/remesh` for quad
  topology, or `meshy/rigging` for humanoids. Meshy's rigging takes a GLB URL, which
  is exactly what our port already carries — no download or re-upload between nodes.
- Real progress for multi-minute nodes; the SSE stream only says running/done today

**Open** Does `render3d` emit N images from one node, like Divider's `out1..outN`, or
one image per instance?

**Done when** A mesh made in SpotOn produces four consistent views that a FAL AI node
accepts as reference images.

---

## Adjustments

_None queued right now._

---

## Notes

- Key strategy: one fal.ai account we own and bill, one API key per person issued
  from it, revoke on offboarding. Usage and spend are read from fal's own dashboard,
  per key — no server, no event log, no proxy needed for this. This is why P2 and P3
  are cancelled (see below).
- User data is in `%APPDATA%\SpotOn` (macOS: `~/Library/Application Support/SpotOn`),
  outside the install dir. Installs and uninstalls never touch it. Overridable with
  `SPOTON_DATA_DIR`.
- We are behind a TLS-inspecting corporate proxy: `truststore` is injected at startup
  and `SSL_VERIFY=false` exists as an escape hatch. Prefer Microsoft-owned endpoints —
  third-party SaaS and email providers get blocked.
- Workflows and templates are JSON graphs stored in SQLite. Renaming or deleting a node
  type breaks saved user work. Always ship a migration or a placeholder.
- `collection/` and `uploads/` dwarf `spoton.db` (hundreds of MB vs under 1 MB) and
  migrations never touch them, so backups before an upgrade cover the database only.
- 3D node type names are permanent the moment anyone saves a workflow (see the node
  type note above). Settle `imageTo3d`, `textTo3d`, `render3d` and `export3d` before
  P6 ships, not during P7.
- fal's 3D output URLs are not permanent. Anything we expect to reopen later has to
  be downloaded into `MODELS_DIR` at generation time.

---

## Backlog

- Prompt storage for usage insight (schema-ready, off by default — privacy call)
- Code signing certificate for Windows
- Power BI on top of the event log, if the simple page stops being enough
- Intel Mac support
- Delta/differential updates (probably never worth it)
- Multiview to 3D (`tripo3d/h3.1/multiview-to-3d`, `meshy/v7/multi-image-to-3d`) —
  much better geometry, needs four wired image inputs
- Part segmentation (`tripo3d/tripo/segment`, `hunyuan-3d/v3.1/part`) — fans one mesh
  into N parts, structurally the same as the Divider node
- Retexture (`trellis-2/retexture`, `hitem3d/hi3d/texture`) — one mesh, many texture
  branches side by side, the case a node graph wins outright
- Sketch to 3D (`hunyuan3d-v3/sketch-to-3d`) — pairs with the Sketch2Final node
- More entries in the `imageTo3d` dropdown: Meshy v7, Rodin v2.5, Trellis 2

---

## Ideas

- Shared templates and collections across the studio, via the service we now have
- Per-user monthly spend caps, once the proxy sees every job
- Gaussian splats (`tripo3d/triposplat`) — different artifact, different viewer
- Text to motion (`hunyuan-motion`) once meshes can be rigged

---

## Cancelled

### P2 · SpotOn Cloud foundation · cancelled 2026-08-12

Was: Azure App Service + Entra sign-in + a server-side fal proxy, so the fal key
never touches a laptop and offboarding is instant.

Superseded by a much cheaper fix: one fal.ai account we own, one API key per person,
revoked by hand on offboarding. No Azure, no IT lead time, no server to run. Loses
automatic offboarding and the "key never leaves the server" property — acceptable
at our current size. Revisit if the team outgrows hand-revocation, or if a leaked
key becomes a real incident rather than a hypothetical one.

### P3 · Usage + spend dashboard · cancelled 2026-08-12

Was: an append-only event log plus a password-protected page for spend and usage,
built because a single shared key gave us no way to attribute cost.

Superseded by the same per-user-key change: fal's own dashboard already attributes
spend and usage per key, so per-person numbers are one login away with nothing to
build or maintain. Revisit only if that per-key breakdown turns out to be missing
or too coarse once billing is live.

---

## Archive

### P1 · fal.ai only · 2026-08-11

Every AI call now goes to fal.ai. Installer dropped from 87 MB to 28.5 MB, and the
installed folder from 321 MB to 83 MB — the ONNX runtime was most of it.

- `removeBg` runs on `fal-ai/birefnet/v2` instead of local rembg. It keeps the
  `rawImage`/`rawMask` contract, so the preview modal and all post-processing
  (feather, dilate, background fill) were untouched. Old rembg model ids saved in
  workflows map to the closest birefnet variant. Trade-off accepted: the node now
  costs money and needs internet.
- `imageScfPrompt` runs on `fal-ai/any-llm/vision`. Verified against the Gemini
  output on real collection images before the Gemini path was deleted.
- Deleted: `nanoBananaPro`, `nanoBanana2`, `gptImage2`, the Gemini/OpenAI key
  endpoints, their `user_secrets` columns, their Settings sections, and their
  playground presets. Dropped `google-genai`, `rembg`, `onnxruntime`, `pymatting`.
- All four removed node types render as a marked placeholder that names the FAL AI
  model to swap in, and executing one returns that same sentence as its error.
  Placeholders keep their handles, so the 8 saved workflows kept all 47 edges.
- Shared fal plumbing (key resolution, client, upload, download, error shaping) now
  lives in `backend/nodes/fal_common.py`, which is where the P2 proxy will slot in.
- Fixed along the way: the key status endpoint reported `managedByEnv: false` even
  when `FAL_KEY` was the only key present.

Verified end to end against both a dev server and the built exe on a fresh data
directory: generation, background removal, image-to-prompt, the remove-bg tool
endpoint, legacy node errors, and the `user_secrets` column migration.
