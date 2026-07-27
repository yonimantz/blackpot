# Gemini API keys and Google Cloud projects — notes for this project

This document summarizes what matters from Google's official guide on [using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key) (including the **Google Cloud projects** section) and how it applies to **SpotOn**.

## Why Google Cloud projects matter

- Every Gemini API key is tied to a **Google Cloud project**. That project is where **billing**, **quotas**, and **who can manage keys** are rooted.
- **Google AI Studio** is a lighter UI on top of those projects: you create and name keys there, and you can **import** Cloud projects that are not shown by default.
- **New users** often get a **default** Cloud project and key after accepting the Terms of Service; **existing** Google Cloud users may not get that default automatically.
- If a key does not appear in AI Studio, you may need to **import the project** (Dashboard → Projects → Import projects), then create or use a key under that project.
- For stricter management (restrictions, rotation, which APIs a key can call), use the [Google Cloud Console credentials](https://console.cloud.google.com/apis/credentials) page for the same project.

## What the official docs say about environment variables

Google's libraries automatically pick up:

| Variable           | Notes |
|--------------------|--------|
| `GEMINI_API_KEY`   | Supported |
| `GOOGLE_API_KEY`   | Supported; **if both are set, `GOOGLE_API_KEY` wins** |

Recommendation from Google: set **only one** of these for auto-discovery, to avoid confusion.

SpotOn does not rely on auto-discovery — it reads `GEMINI_API_KEY` itself and passes the key explicitly to `genai.Client(api_key=...)`.

## How *this* project uses keys

The **backend** owns every AI call; keys never reach the browser.

### Resolution order (same for all AI image nodes)

1. **Per-node `apiKey`** in the workflow (inspector), if non-empty.
2. **The key saved on the Settings page**, stored server-side in the local SQLite `user_secrets` table.
3. **`GEMINI_API_KEY` in `backend/.env`** as a fallback.

Helper: `resolve_gemini_api_key()` in `backend/nodes/ai_nodes.py`. The OpenAI and fal.ai nodes follow the same three-step order with `OPENAI_API_KEY` and `FAL_KEY`.

## Security

1. **Treat keys like passwords** — quota, cost, and any uploaded workflow data flow through them.
2. **Never commit API keys** — `backend/.env` is gitignored; `.env.example` holds placeholders only.
3. **Keys stay on the backend** — the React app never embeds a key.
4. **Restrict keys when possible** — in Cloud Console, restrict usage to the **Generative Language API**.
5. **Rotate and audit** — if a key was ever leaked (chat, screenshot, public repo), **revoke and create a new key** in the same Cloud project.

Note that keys saved from the Settings page are stored in plain text in the local database, which is readable by anyone with access to that Windows account. This is the same trust level as a `.env` file on the same machine.

## Operational checklist

- [ ] Key created under the **correct** Cloud project in [Google AI Studio](https://aistudio.google.com/) (or an imported project).
- [ ] Billing / quotas understood for that project (especially for image models).
- [ ] Key entered on the **Settings** page, or set as `GEMINI_API_KEY` in `backend/.env`.
- [ ] `.env` not tracked by version control.

## Reference

- [Using Gemini API keys — Google AI for Developers](https://ai.google.dev/gemini-api/docs/api-key) (includes **Google Cloud projects**, env vars, and explicit `api_key` examples)
