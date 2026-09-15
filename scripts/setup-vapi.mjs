#!/usr/bin/env node
// Creates (or updates) the Vapi assistant from vapi/system-prompt.txt + vapi/tools.json,
// wires its tool-call webhook to the Convex HTTP API, and attaches it to the
// phone number. Re-running this is safe — pass VAPI_ASSISTANT_ID to update in place.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadDotEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  } catch {
    // no .env.local, that's fine — rely on real env vars
  }
}
loadDotEnv();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID || !CONVEX_SITE_URL) {
  console.error(
    "Missing required env vars. Need VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, NEXT_PUBLIC_API_BASE_URL in .env.local"
  );
  process.exit(1);
}

const systemPrompt = readFileSync(join(root, "vapi", "system-prompt.txt"), "utf8");
const tools = JSON.parse(readFileSync(join(root, "vapi", "tools.json"), "utf8"));

const toolsWithServer = tools.map((t) => ({
  ...t,
  server: { url: `${CONVEX_SITE_URL}/vapi/tool-calls` },
}));

const assistantPayload = {
  name: "Patient Registration Intake",
  firstMessage:
    "Thanks for calling Riverside Family Clinic, this is Alex! I can get you set up as a new patient in just a couple minutes — sound good? Let's start with your name.",
  model: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.3,
    messages: [{ role: "system", content: systemPrompt }],
    tools: toolsWithServer,
  },
  voice: { provider: "vapi", voiceId: "Emma" },
  transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
  endCallFunctionEnabled: true,
  // Belt-and-suspenders call termination: the model is instructed to say this
  // exact closing line, and Vapi auto-hangs-up as soon as it's spoken — more
  // reliable than depending on the model to also invoke an end-call function.
  endCallPhrases: ["Thanks again for calling Riverside Family Clinic — take care!"],
  // If the caller goes quiet for 10s, check in once; if still silent 10s after
  // that (20s total, via silenceTimeoutSeconds below), end the call.
  hooks: [
    {
      name: "idle_check_in",
      on: "customer.speech.timeout",
      options: { timeoutSeconds: 10, triggerMaxCount: 1, triggerResetMode: "onUserSpeech" },
      do: [{ type: "say", exact: "Are you still there?" }],
    },
  ],
  silenceTimeoutSeconds: 20,
};

async function main() {
  const existingId = process.env.VAPI_ASSISTANT_ID;
  const url = existingId
    ? `https://api.vapi.ai/assistant/${existingId}`
    : "https://api.vapi.ai/assistant";
  const method = existingId ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistantPayload),
  });
  const assistant = await res.json();
  if (!res.ok) {
    console.error("Failed to create/update assistant:", assistant);
    process.exit(1);
  }
  console.log(`Assistant ${method === "POST" ? "created" : "updated"}: ${assistant.id}`);

  const phoneRes = await fetch(`https://api.vapi.ai/phone-number/${VAPI_PHONE_NUMBER_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assistantId: assistant.id }),
  });
  const phone = await phoneRes.json();
  if (!phoneRes.ok) {
    console.error("Failed to attach assistant to phone number:", phone);
    process.exit(1);
  }
  console.log(`Attached to phone number: ${phone.number}`);
  console.log("\nSave this for re-runs (optional):");
  console.log(`VAPI_ASSISTANT_ID=${assistant.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
