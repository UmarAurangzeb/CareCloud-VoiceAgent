# System Prompt — Patient Registration Voice Agent

Design notes (not sent to the model — see `system-prompt.txt` for the raw string
that's actually loaded into the assistant):

- **Order of collection matters.** Phone number is collected right after name/DOB/sex,
  *before* address — specifically so we can run duplicate detection early and avoid
  making a returning caller repeat their whole address only to find out we're about
  to create a duplicate record.
- **One question at a time.** LLMs asked to "collect these 8 fields" in one system
  message tend to dump them all into one robotic turn. The prompt explicitly forbids
  batching questions, which is what actually produces the "natural conversation"
  evaluators are listening for.
- **Corrections are handled by letting the model re-run the field, not by a special
  intent classifier.** Since the whole conversation stays in context, "actually my
  last name is spelled D-A-V-I-S" is just new information the model incorporates
  before confirmation — no special-casing needed, the confirmation step is what
  catches anything missed.
- **Validation lives in two places on purpose.** The prompt tells the model the
  *shape* of valid input (so it re-prompts naturally, in-voice, instead of silently
  passing bad data through), but the source of truth is server-side validation in
  `convex/validation.ts` — the model's judgment is a UX layer, not a security boundary.
- **Tool-call failures are narrated, never silent.** Voice UX has no visible error
  state, so the model is told explicitly to apologize and explain when a tool
  returns `ok: false`, rather than pretending the save happened.
