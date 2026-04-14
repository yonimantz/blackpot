# Publishing plan (features first, then go live)

This is a **timeline**: what to do **while you still build features**, and what to do **when you decide to publish**. Step-by-step commands and env details stay in [DEV_TO_PUBLISH.md](DEV_TO_PUBLISH.md) and [README.md](../README.md).

---

## How to use this doc

| You are here | Focus on |
|--------------|----------|
| **Now** — still adding features | [Phase 1](#phase-1--feature-work-now) |
| **Soon** — wrapping up for real users | [Phase 2](#phase-2--pre-publish-readiness) |
| **Go-live week** | [Phase 3](#phase-3--implement-publishing) + [Phase 4](#phase-4--invite-only-access) |
| **Already live** | [Phase 5](#phase-5--after-launch-updates--invites) |

---

## Phase 1 — Feature work (now)

**Goal:** Keep shipping locally without blocking on production setup.

- Use your normal dev flow (`run.bat`, or backend + `npm run dev` in `frontend/`).
- It is fine to use **`AUTH_SKIP_ALLOWLIST=1`** and optional **`GEMINI_API_KEY`** in `backend/.env` while iterating — just **do not** leave those on for production (see Phase 2).
- Avoid committing secrets; rotate anything that leaked into chat or screenshots.

**Optional early prep** (only if you want to reduce rush later):

- Confirm Firebase project exists and **Auth / Firestore / Storage / Hosting** are enabled when you are ready to test “like production.”
- Keep a short list of **production URLs** you will need for CORS (`CORS_ORIGINS` on Cloud Run).

You **do not** need to deploy Hosting or Cloud Run to finish features.

---

## Phase 2 — Pre-publish readiness

**Goal:** A short “we can invite people” bar before you run deploy commands.

Work through [DEV_TO_PUBLISH.md §2](DEV_TO_PUBLISH.md) in spirit:

- [ ] Production frontend build succeeds: `cd frontend && npm run build` (fix TS/build errors).
- [ ] Sign-in and API behavior tested **without** relying on a shared `GEMINI_API_KEY` if you want per-user keys only (see [GEMINI_API_KEYS.md](GEMINI_API_KEYS.md)).
- [ ] **Invite list** decided: `ALLOWLIST_EMAILS` and/or Firestore `config/allowed_emails` — and **`AUTH_SKIP_ALLOWLIST` removed** for any environment that faces the internet.
- [ ] **Security checklist** from [DEV_TO_PUBLISH.md §3](DEV_TO_PUBLISH.md): Auth authorized domains (you will add the live URL in Phase 3), CORS, Cloud Run env, `DATA_BACKEND=firestore` for multi-user hosted data, no prod secrets in the client bundle.

When this phase is done, you are ready to **implement publishing** (Phase 3).

---

## Phase 3 — Implement publishing

**Goal:** First time the app and backend are reachable on your real Hosting URL.

Do in order (details and commands in [DEV_TO_PUBLISH.md](DEV_TO_PUBLISH.md)):

1. **Deploy Cloud Run** — backend image, env vars, service name matches `firebase.json` → `blackpot-api` (or change config to match). Use `backend/cloud-run-env.yaml.example` → `cloud-run-env.yaml` and [scripts/deploy-cloud-run.ps1](../scripts/deploy-cloud-run.ps1) on Windows, or `gcloud run deploy` from [README.md](../README.md).
2. **Deploy Firebase** — Firestore rules, Storage rules, indexes if needed, then **Hosting** after `npm run build`. On Windows you can run [scripts/deploy-phase3.ps1](../scripts/deploy-phase3.ps1) after `firebase login`.
3. **Firebase Console → Authentication → Authorized domains** — add your production domain (and custom domain if you use one).
4. **Smoke test** on the hosted URL (signed-in allowed user, Settings + AI flow) per [DEV_TO_PUBLISH.md §6](DEV_TO_PUBLISH.md).

---

## Phase 4 — Invite-only access

**Goal:** Only people you approve can use the app, even if someone finds the URL.

**What this repo is already set up for (backend gate):**

- Allowed emails via **`ALLOWLIST_EMAILS`** (Cloud Run env) and/or Firestore **`config/allowed_emails`**.
- **`AUTH_SKIP_ALLOWLIST`** must be **off** in production.

That gates **API access** for signed-in users. Keep Firestore/Storage **rules** tight as well (deployed with Firebase).

**Optional later (Firebase Auth blocking):**

- A **`beforeUserCreated`** Cloud Function that reads an allowlist and **blocks account creation** for non-invited emails. Use this if you want the **account itself** never created for strangers, not only API rejection. Plan time to implement, deploy functions, and test each sign-in provider you use (e.g. Google email must match the invited address).

**Practical order:** Ship with backend allowlist + rules first; add Auth blocking if you need stricter behavior.

---

## Phase 5 — After launch (updates + invites)

**Shipping code/UI fixes**

- Local changes → `npm run build` → redeploy **Hosting**.
- Backend changes → rebuild image → redeploy **Cloud Run**.
- Rules/index changes → `firebase deploy` for the relevant targets.

**Adding or removing someone**

- If you use **Firestore** for the list: update `config/allowed_emails` (often **no** redeploy).
- If you use **only env** `ALLOWLIST_EMAILS`: update Cloud Run env and **redeploy** (or roll out a new revision).

**Reminder:** Publishing is **repeatable** — each update is “build + deploy” again; user data in Firestore is not wiped by deploying the site.

---

## Related docs

| Doc | Role |
|-----|------|
| [DEV_TO_PUBLISH.md](DEV_TO_PUBLISH.md) | Concrete commands and checklist for deploy |
| [GEMINI_API_KEYS.md](GEMINI_API_KEYS.md) | How API keys are resolved for AI nodes |
| [README.md](../README.md) | Quick start, env vars, deploy snippets |
