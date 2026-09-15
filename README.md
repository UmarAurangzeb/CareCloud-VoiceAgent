# CareCloud Voice Agent — Patient Registration System

A voice AI agent that answers a real phone number, conversationally registers a new
patient (or updates an existing one), persists the record to a database, and exposes
it through a REST API + dashboard.

**Call it:** +1 (346) 998-6653
**API base URL:** `https://lovable-wolf-735.convex.site`
**Dashboard:** run locally (see below) — `npm run dev`, then `http://localhost:3000`

## Architecture

```
Caller ──phone──> Vapi (telephony + STT/TTS + LLM orchestration)
                        │
                        │ tool-call webhook (function calling)
                        ▼
              Convex HTTP Action  /vapi/tool-calls
                        │
                        ▼
              Convex mutations/queries (service layer)  ◄──┐
                        │                                   │
                        ▼                                   │
                  Convex database                           │
                        ▲                                   │
                        │                                   │
              Convex HTTP Action  /patients (REST API) ─────┘
                        ▲
                        │
              Next.js dashboard (browser)
```

- **Telephony + Voice AI: [Vapi](https://vapi.ai)** — handles the phone number, speech-to-text,
  text-to-speech, and turn-taking. Chosen over raw Twilio + Deepgram/ElevenLabs because it collapses
  three integrations into one, which matters a lot inside a 3-hour window — the FAQ explicitly
  encourages this ("we encourage it... not your ability to implement a speech-to-text engine").
- **LLM: OpenAI `gpt-4o-mini`** via Vapi's model integration — fast, cheap, and Vapi's function-calling
  with it is well-tested.
- **Database + REST API: [Convex](https://convex.dev)** — a single backend serves both roles. Convex's
  `httpAction`s let the REST endpoints (`/patients`) and the Vapi tool-call webhook
  (`/vapi/tool-calls`) live in the same deployment and call the *same* mutations/queries directly
  (no self-HTTP round trip), which is exactly the "or directly invoke the same service layer" option
  the spec calls out. It also gives real persistence (survives restarts) with zero infra to manage.
- **Dashboard: Next.js** — a small client-rendered table polling the REST API every 5s (bonus:
  simple web UI requirement).

### Why Convex over Postgres/SQLite here

The brief explicitly rewards *smart trade-offs under time pressure* over infra purity. Standing up
Postgres + an Express server would mean writing a connection pool, migrations, and a separate deploy
target — all before writing a single line of the part actually being evaluated (the conversation and
the integration). Convex gives schema + persistence + a deployed HTTPS endpoint in one `npx convex dev`,
so nearly the entire budget went to the voice agent and its prompt instead.

## Data flow for a call

1. Caller dials the Vapi number → Vapi assistant answers with the configured first message.
2. The assistant (system prompt in [`vapi/system-prompt.txt`](vapi/system-prompt.txt)) collects
   required fields one at a time, in natural conversation.
3. As soon as the phone number is collected, the assistant silently calls the `lookup_patient_by_phone`
   tool. If a match is found, it offers to update instead of creating a duplicate (bonus requirement).
4. Once all required fields are collected (and any optional ones the caller opts into), the assistant
   reads everything back and asks for confirmation.
5. On confirmation, it calls `create_patient` (or `update_patient` in update mode). Both are handled by
   [`convex/vapiTools.ts`](convex/vapiTools.ts), which validates server-side
   ([`convex/validation.ts`](convex/validation.ts)) and writes via the same mutations
   ([`convex/patients.ts`](convex/patients.ts)) the REST API uses.
6. The assistant relays the real outcome back to the caller — including a spoken, specific error and a
   retry if the write fails validation. Every tool call and its result is logged to stdout
   (`console.log` in `vapiTools.ts`), visible in the Convex dashboard's function logs.
7. The patient is now visible via `GET /patients` and on the dashboard, and will be found again on a
   second call to the same number (persistence requirement).

## REST API

Base URL: `https://lovable-wolf-735.convex.site` (Convex HTTP Actions). All responses use the
envelope `{ "data": ..., "error": ... }`.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/patients` | List patients. Optional query params: `last_name`, `date_of_birth`, `phone_number` |
| GET | `/patients/:id` | Get one patient by `patient_id` (UUID) |
| POST | `/patients` | Create a patient. 422 with per-field errors on invalid input |
| PUT | `/patients/:id` | Partial update |
| DELETE | `/patients/:id` | Soft delete (sets `deleted_at`; row is kept) |

Example:

```bash
curl -X POST https://lovable-wolf-735.convex.site/patients \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane", "last_name": "Doe", "date_of_birth": "1990-05-15",
    "sex": "Female", "phone_number": "5551234567",
    "address_line_1": "123 Main St", "city": "Austin", "state": "TX", "zip_code": "78701"
  }'
```

Validation (`convex/validation.ts`) runs on every request regardless of caller — the voice agent's
own field checks are a conversational UX nicety, not the security boundary.

## Data model

See [`convex/schema.ts`](convex/schema.ts) — implements the full field list from the spec
(required/optional/auto fields, `patient_id` as a server-generated UUID separate from Convex's
internal `_id`, indexes on `patient_id`, `phone_number`, `last_name`, `date_of_birth` to serve the
REST query params and duplicate lookup without a table scan).

## Prompt engineering

The full system prompt is [`vapi/system-prompt.txt`](vapi/system-prompt.txt); design rationale is in
[`vapi/system-prompt.md`](vapi/system-prompt.md). Key decisions:

- **Phone number is collected before address**, specifically so duplicate detection (`lookup_patient_by_phone`)
  runs before the caller has repeated their whole address into a record we're about to throw away.
- **"One question at a time" is stated explicitly** — the single biggest lever for sounding natural
  instead of like an IVR form-fill.
- **Corrections aren't special-cased.** The whole call stays in one context window, so "actually it's
  spelled D-A-V-I-S" is just new information the model folds in before the confirmation read-back
  catches anything else.
- **Tool failures are always narrated**, never silent — voice has no visible error state.

## Edge cases handled

| Case | Handling |
|---|---|
| Invalid date of birth / future DOB | Server validates (`isValidDateOfBirth`); prompt also tells the model to catch this conversationally and re-ask just that field |
| Invalid phone (not 10 digits) | Same — caught client-side by the prompt *and* enforced server-side in `validation.ts` |
| Database write fails | Tool returns `{ ok: false, message, fields }`; assistant is instructed to apologize, explain the specific problem, and retry — never claim success silently |
| Caller wants to start over | Prompt explicitly instructs the model to discard in-call state and restart from first name |
| Returning caller (duplicate) | `lookup_patient_by_phone` tool runs proactively; assistant offers update-instead-of-create |
| Telephony connection drops mid-call | No partial writes happen — the agent only calls `create_patient`/`update_patient` once, after confirmation, so a drop before that point simply leaves no record (caller can call back and start fresh) |
| Malformed/missing fields hitting the REST API directly (not via voice) | 422 with a `fields` array naming exactly which fields failed and why |

## Setup

### Prerequisites
- Node 18+
- A [Convex](https://convex.dev) account (free)
- A [Vapi](https://vapi.ai) account (free — phone numbers are free/inbound-only on new accounts)
- An OpenAI API key

### Steps

```bash
npm install

# Starts the Convex dev deployment, prints CONVEX_DEPLOYMENT/NEXT_PUBLIC_CONVEX_URL
# into .env.local automatically, and live-syncs convex/ on every save.
npx convex dev
```

In a second terminal:

```bash
# Add these to .env.local (see .env.example):
#   NEXT_PUBLIC_API_BASE_URL=<the *.convex.site URL printed by `npx convex dev`>
#   VAPI_API_KEY=<from Vapi dashboard: Settings > API Keys>
#   VAPI_PHONE_NUMBER_ID=<from Vapi dashboard: Phone Numbers>
# Add your OpenAI key as a Provider Key in the Vapi dashboard (Settings > Provider Keys),
# or via: curl -X POST https://api.vapi.ai/credential -H "Authorization: Bearer $VAPI_API_KEY" \
#   -H "Content-Type: application/json" -d '{"provider":"openai","apiKey":"'$OPENAI_API_KEY'"}'

node scripts/setup-vapi.mjs   # creates the assistant from vapi/system-prompt.txt + vapi/tools.json
                               # and attaches it to your phone number

npm run dev                   # dashboard at http://localhost:3000
```

Re-running `node scripts/setup-vapi.mjs` after editing the prompt or tools updates the same assistant
in place (set `VAPI_ASSISTANT_ID` in `.env.local`, printed by the first run).

## Environment variables

| Variable | Used by | Description |
|---|---|---|
| `CONVEX_DEPLOYMENT` | Convex CLI | Auto-set by `npx convex dev` |
| `NEXT_PUBLIC_CONVEX_URL` | Next.js (Convex client, unused directly here but standard) | Auto-set by `npx convex dev` |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | reference | Auto-set by `npx convex dev`; the HTTP Actions base URL |
| `NEXT_PUBLIC_API_BASE_URL` | Next.js dashboard, `scripts/setup-vapi.mjs` | Same value as `NEXT_PUBLIC_CONVEX_SITE_URL` — the REST API base |
| `VAPI_API_KEY` | `scripts/setup-vapi.mjs` | Vapi private API key, used only to create/update the assistant |
| `VAPI_PHONE_NUMBER_ID` | `scripts/setup-vapi.mjs` | Which Vapi phone number to attach the assistant to |
| `VAPI_ASSISTANT_ID` | `scripts/setup-vapi.mjs` (optional) | If set, updates this assistant instead of creating a new one |

No API keys are hardcoded anywhere in source — `.env.local` is gitignored. The OpenAI key lives only
in Vapi's own dashboard (Provider Keys), never in this codebase.

## Known limitations / trade-offs

- **No automated tests** — out of scope for the time budget; would add `convex-test` + `vitest` for the
  mutation/validation layer first (see the Convex testing guidelines in `convex/_generated/ai/guidelines.md`).
- **No call transcript storage** — only the final structured payload and tool-call outcomes are logged
  (stdout / Convex function logs), not a full transcript. Vapi does retain call recordings/transcripts
  on its own dashboard if needed.
- **No multi-language support implemented** — the prompt doesn't handle a "Hablo español" switch; Vapi
  supports multilingual transcription/TTS, so this is a config change away, not a rebuild.
- **`GET /patients` isn't paginated** — fine at demo scale; would move to Convex's `.paginate()` for a
  real deployment (flagged, not fixed, per Convex's own guidance on unbounded `.collect()`).
- **Dashboard has no create/edit form** — read-only view, since the assignment's dashboard bonus only
  asks to "display registered patients."
- **Vapi's free phone number is inbound-only** on new accounts, which is exactly what this project
  needs (caller dials in) — documented here in case outbound calling is ever required later.

## Next steps (if given more time)

- Add automated tests for `convex/validation.ts` and the REST endpoints.
- Store a per-call transcript/summary linked to `patient_id` (bonus requirement).
- Add appointment scheduling as a second tool + table (bonus requirement).
- Add a create/edit form to the dashboard instead of read-only.
- Multi-language support via Vapi's transcriber/voice language switching.
