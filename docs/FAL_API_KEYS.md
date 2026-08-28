# fal.ai API keys — notes for this project

SpotOn runs every AI node on [fal.ai](https://fal.ai): image generation, background
removal, and image-to-prompt. One provider, one shared billing account, one key per
person.

## Getting a key

The studio owns a single fal.ai account and pays for it. Nobody creates their own
account or their own billing — the account owner issues a personal key per person
from [Dashboard → Keys](https://fal.ai/dashboard/keys) and hands it out.

1. Ask whoever manages the studio's fal.ai account for your personal key. It looks
   like `<key-id>:<key-secret>` and is only shown to them once, at creation.
2. Paste it into SpotOn's **Settings** page.

Usage is billed per call to the shared account, but per-person spend and usage are
still visible in the fal.ai dashboard, broken down by key — so there is no need for
SpotOn itself to track or report spend. fal charges by model and by image, so
background removal and image-to-prompt cost money too, not just generation — they
used to run locally, for free.

When someone leaves or should no longer have access, the account owner revokes
their specific key from the dashboard. That alone cuts them off; nothing on their
machine needs to change.

## How this project uses keys

The **backend** owns every AI call; keys never reach the browser.

Resolution order, applied by `resolve_api_key()` in `backend/nodes/fal_common.py`:

1. **Per-node `apiKey`** in the workflow (inspector), if non-empty.
2. **The key saved on the Settings page**, stored server-side in the local SQLite
   `user_secrets` table.
3. **`FAL_KEY` in `backend/.env`** as a fallback. When only this is set, Settings
   reports the key as managed by the environment and does not offer to remove it.

## Security

1. **Treat the key like a password** — cost and any uploaded image data flow through it.
2. **Never commit it** — `backend/.env` is gitignored; `.env.example` holds placeholders only.
3. **Keys stay on the backend** — the React app never embeds one.
4. **Rotate if leaked** — ask the account owner to revoke your key in the fal
   dashboard and issue you a new one; most people won't have access to do this
   themselves on a shared account.

Keys saved from the Settings page are stored in plain text in the local database,
readable by anyone with access to that Windows account. Same trust level as a
`.env` file on the same machine.

## Reference

- [fal.ai dashboard keys](https://fal.ai/dashboard/keys)
- [fal.ai model gallery](https://fal.ai/models) — the endpoint ids used by the FAL AI node
