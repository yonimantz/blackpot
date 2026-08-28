# Installing SpotOn

For whoever receives `SpotOn-Setup.exe`. Nothing here needs a developer setup — the installer contains everything except the AI services SpotOn talks to.

## What you need

- Windows 10 or 11, 64-bit
- About 120 MB of free disk space
- An internet connection (every node that touches an image model runs in the cloud, not on your machine)
- A fal.ai API key — see [API key](#api-key) below

You do **not** need administrator rights. SpotOn installs into your own user folder.

## Install

1. Run `SpotOn-Setup.exe`.
2. Windows will likely warn that the publisher is unknown, because the installer is not code-signed. Choose **More info**, then **Run anyway**. If your browser flagged the download for the same reason, keep it.
3. Accept the defaults and finish. That puts SpotOn in `%LOCALAPPDATA%\Programs\SpotOn` with a Start Menu entry.

## Running it

Launch **SpotOn** from the Start Menu. Two things appear:

- A black console window showing `SpotOn is running at http://127.0.0.1:8000`. **Leave it open** — it is the app itself. Closing it shuts SpotOn down.
- Your browser, opened on the app.

SpotOn runs entirely on your own machine; that `127.0.0.1` address is not reachable by anyone else.

To quit, close the console window. Launching SpotOn again while it is already running just opens a new browser tab pointing at the copy that is already up.

## API key

Everything SpotOn generates runs on [fal.ai](https://fal.ai) — images, background removal, and image-to-prompt. It ships with no key. Ask whoever manages your studio's fal.ai account for your personal key, then open the **Settings** page and paste it in. The key is stored locally and is sent only to fal.ai. [fal.ai API keys](FAL_API_KEYS.md) has the details.

Costs land on the studio's shared fal.ai account, per image — not a personal one.

## Where your work is stored

Everything lives in `%APPDATA%\SpotOn` — paste that into Explorer's address bar to open it:

| Path | Contents |
|------|----------|
| `spoton.db` | Your workflows, collection metadata and saved API keys |
| `collection/` | Generated images |
| `uploads/` | Images you imported |
| `exports/` | Where the Export node writes by default |

Back up that folder and you have backed up everything.

## Uninstalling

Use **Settings → Apps → Installed apps → SpotOn**, or the uninstall entry in the SpotOn Start Menu folder.

Uninstalling removes the program but **leaves `%APPDATA%\SpotOn` alone**, so your workflows and images survive a reinstall or an upgrade. Delete that folder by hand if you want it gone too.

## If something goes wrong

**The browser did not open.** The console window prints the address; open it manually, usually <http://127.0.0.1:8000>.

**"Cannot reach the SpotOn server" in the browser.** The console window was closed or crashed. Close the tab and start SpotOn again.

**Port 8000 is used by something else.** SpotOn tries the next free port automatically and prints the one it settled on. Set the `SPOTON_PORT` environment variable to steer it somewhere specific.

**An image node fails with an authentication or quota error.** That comes from fal.ai, not SpotOn. Check the key on the Settings page first; if it looks right, ask whoever manages the studio's fal.ai account whether your key was revoked or the shared account is out of credit.

**Anything else.** The console window keeps the error text, so copy what it says when reporting a problem.
