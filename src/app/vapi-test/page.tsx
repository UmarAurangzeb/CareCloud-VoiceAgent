"use client";

import { useEffect, useRef, useState } from "react";

// Talks directly to the published Vapi assistant over WebRTC, bypassing the
// Vapi dashboard's Composer editor entirely (which keeps its own separate,
// frequently out-of-sync draft — see README "Known limitations"). Useful for
// testing without dialing the real phone number.

declare global {
  interface Window {
    vapiSDK?: { run: (opts: { apiKey: string; assistant: string }) => VapiInstance };
  }
}

type VapiInstance = {
  start: () => void;
  stop: () => void;
  on: (event: string, cb: (payload?: unknown) => void) => void;
};

type TranscriptLine = { role: string; text: string };

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";

export default function VapiTestPage() {
  const [status, setStatus] = useState<"idle" | "connecting" | "active" | "ended">("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const vapiRef = useRef<VapiInstance | null>(null);

  useEffect(() => {
    if (!PUBLIC_KEY || !ASSISTANT_ID) return;
    if (window.vapiSDK) return;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js";
    script.defer = true;
    script.async = true;
    document.body.appendChild(script);
  }, []);

  function startCall() {
    if (!window.vapiSDK) {
      alert("SDK still loading — wait a second and try again.");
      return;
    }
    setStatus("connecting");
    setLines([]);
    const instance = window.vapiSDK.run({ apiKey: PUBLIC_KEY, assistant: ASSISTANT_ID });
    vapiRef.current = instance;

    instance.on("call-start", () => setStatus("active"));
    instance.on("call-end", () => setStatus("ended"));
    instance.on("error", (e) => {
      console.error(e);
      setStatus("ended");
    });
    instance.on("message", (m) => {
      const msg = m as { type?: string; role?: string; transcript?: string; transcriptType?: string };
      if (msg.type === "transcript" && msg.transcriptType === "final" && msg.role && msg.transcript) {
        setLines((prev) => [...prev, { role: msg.role!, text: msg.transcript! }]);
      }
    });
  }

  function endCall() {
    vapiRef.current?.stop();
    setStatus("ended");
  }

  if (!PUBLIC_KEY || !ASSISTANT_ID) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <p className="text-red-400">
          Missing NEXT_PUBLIC_VAPI_PUBLIC_KEY / NEXT_PUBLIC_VAPI_ASSISTANT_ID in .env.local
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Talk to the Voice Agent</h1>
        <p className="text-slate-400 text-sm mb-6">
          Browser mic test of the real, published assistant — no phone call needed.
        </p>

        <div className="flex items-center gap-3 mb-6">
          {status === "idle" || status === "ended" ? (
            <button
              onClick={startCall}
              className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 font-medium"
            >
              {status === "ended" ? "Call again" : "Start call"}
            </button>
          ) : (
            <button
              onClick={endCall}
              className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 font-medium"
            >
              End call
            </button>
          )}
          <span className="text-sm text-slate-400 capitalize">{status}</span>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 min-h-[200px] space-y-2">
          {lines.length === 0 && (
            <p className="text-slate-500 text-sm">Transcript will appear here once the call starts.</p>
          )}
          {lines.map((l, i) => (
            <p key={i} className="text-sm">
              <span className={l.role === "assistant" ? "text-emerald-400" : "text-sky-400"}>
                {l.role === "assistant" ? "Alex" : "You"}:
              </span>{" "}
              <span className="text-slate-200">{l.text}</span>
            </p>
          ))}
        </div>
      </div>
    </main>
  );
}
