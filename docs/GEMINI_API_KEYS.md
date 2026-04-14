# Gemini API keys and Google Cloud projects — notes for this project

This document summarizes what matters from Google’s official guide on [using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key) (including the **Google Cloud projects** section) and how it applies to **Blackpot**.

## Why Google Cloud projects matter

- Every Gemini API key is tied to a **Google Cloud project**. That project is where **billing**, **quotas**, and **who can manage keys** are rooted.
- **Google AI Studio** is a lighter UI on top of those projects: you create and name keys there, and you can **import** Cloud projects that are not shown by default.
- **New users** often get a **default** Cloud project and key after accepting the Terms of Service; **existing** Google Cloud users may not get that default automatically.
- If a key does not appear in AI Studio, you may need to **import the project** (Dashboard → Projects → Import projects), then create or use a key under that project.
- For stricter management (restrictions, rotation, which APIs a key can call), use the [Google Cloud Console credentials](https://console.cloud.google.com/apis/credentials) page for the same project.

## What the official docs say about environment variables

Google’s libraries automatically pick up:

| Variable           | Notes |
|--------------------|--------|
| `GEMINI_API_KEY`   | Supported |
| `GOOGLE_API_KEY`   | Supported; **if both are set, `GOOGLE_API_KEY` wins** |

Recommendation from Google: set **only one** of these for auto-discovery, to avoid confusion.

## How *this* project uses keys

The **backend** calls Gemini with an explicit API key passed into `genai.Client(api_key=...)` (see `backend/nodes/ai_nodes.py` and `backend/engine.py`).

### Resolution order (same for all AI image nodes)

1. **Per-node `apiKey`** in the workflow (inspector), if non-empty.
2. **Signed-in user’s saved key** (Settings in the app, stored server-side — SQLite `user_secrets` locally or Firestore `userSecrets/{uid}` in production).
3. **`GEMINI_API_KEY` in `backend/.env`** (or Cloud Run env) as a **fallback**, useful for local development or a single shared dev key. Omit in production if every user should use their own key.

Helper: `resolve_gemini_api_key()` in `backend/nodes/ai_nodes.py`.

### Invite-only / Firebase deployments

- Do **not** bake API keys into the frontend bundle.
- Each invited user pastes their key once on the **Settings** page; the FastAPI backend stores it with Firebase Admin (Firestore) or SQLite when running locally.
- See [README.md](../README.md) for `FIREBASE_PROJECT_ID`, `ALLOWLIST_EMAILS`, and `AUTH_SKIP_ALLOWLIST`.

## Security — critical for this repo

Google’s rules align with how we should run this app:

1. **Treat keys like passwords** — quota, cost, and any uploaded workflow data flow through them.
2. **Never commit API keys** — keep `backend/.env` out of git (use `.gitignore` and a `.env.example` with placeholders only).
3. **Never expose keys in the browser** — the React app must not embed keys; Gemini calls stay on the **FastAPI backend**.
4. **Restrict keys when possible** — in Cloud Console, restrict usage to the **Generative Language API** (and optionally IP / referrer where applicable).
5. **Rotate and audit** — if a key was ever leaked (chat, screenshot, public repo), **revoke and create a new key** in the same Cloud project.

## Operational checklist

- [ ] Keys created under the **correct** Cloud project in [Google AI Studio](https://aistudio.google.com/) (or imported project).
- [ ] Billing / quotas understood for that project (especially for image models).
- [ ] Local: optional `GEMINI_API_KEY` in `backend/.env`, or per-user key in Settings when using Firebase Auth.
- [ ] Production: invited users save their own keys; restrict `CORS_ORIGINS` and avoid a shared `GEMINI_API_KEY` on Cloud Run unless intentional.
- [ ] `.env` not tracked by version control.
- [ ] After team changes, confirm Cloud project access and key permissions in AI Studio or Cloud Console.

## Reference

- [Using Gemini API keys — Google AI for Developers](https://ai.google.dev/gemini-api/docs/api-key) (includes **Google Cloud projects**, env vars, and explicit `api_key` examples)
