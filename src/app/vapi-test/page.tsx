"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import Link from "next/link";
import type Vapi from "@vapi-ai/web";

// Talks to the same published assistant as the phone number, over WebRTC.
// Deliberately not the Vapi dashboard's Composer test, which runs an unpublished draft.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";

type Phase = "loading" | "ready" | "mic" | "connecting" | "live" | "ended" | "error";
type Role = "assistant" | "user";
type Line = { role: Role; text: string };
type TranscriptMessage = { type?: string; role?: string; transcriptType?: string; transcript?: string };

export default function TalkToAlexPage() {
  preconnect("https://api.vapi.ai");

  const vapiRef = useRef<Vapi | null>(null);
  const clickedAt = useRef(0);
  const liveAt = useRef(0);
  const transcriptBox = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState<Line | null>(null);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [connectSeconds, setConnectSeconds] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Load and construct the SDK as soon as the page opens, so clicking "Start" only has to connect.
  useEffect(() => {
    if (!PUBLIC_KEY || !ASSISTANT_ID) return;
    let cancelled = false;
    let instance: Vapi | null = null;

    import("@vapi-ai/web")
      .then(({ default: VapiClient }) => {
        if (cancelled) return;
        instance = new VapiClient(PUBLIC_KEY);

        instance.on("call-start", () => {
          liveAt.current = Date.now();
          setConnectSeconds((liveAt.current - clickedAt.current) / 1000);
          setPhase("live");
        });
        instance.on("call-end", () => {
          setPhase((p) => (p === "error" ? p : "ended"));
          setAssistantSpeaking(false);
          setVolume(0);
          setPartial(null);
        });
        instance.on("speech-start", () => setAssistantSpeaking(true));
        instance.on("speech-end", () => setAssistantSpeaking(false));
        instance.on("volume-level", (v) => setVolume(v));
        instance.on("call-start-failed", (e) => console.error("Vapi call-start-failed", e));
        instance.on("error", (e) => console.error("Vapi error", e));
        instance.on("message", (m: TranscriptMessage) => {
          if (m.type !== "transcript" || !m.transcript) return;
          const role: Role = m.role === "assistant" ? "assistant" : "user";
          const text = m.transcript;

          if (m.transcriptType === "partial") {
            setPartial({ role, text });
            return;
          }
          setPartial((p) => (p?.role === role ? null : p));
          // Vapi finalizes one spoken turn in several chunks; fold them into a single bubble.
          setLines((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === role) {
              return [...prev.slice(0, -1), { role, text: `${last.text} ${text}` }];
            }
            return [...prev, { role, text }];
          });
        });

        vapiRef.current = instance;
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load the calling library. Check your connection and refresh the page.");
        setPhase("error");
      });

    return () => {
      cancelled = true;
      vapiRef.current = null;
      instance?.removeAllListeners();
      instance?.stop().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (phase !== "mic" && phase !== "connecting" && phase !== "live") return;
    const id = setInterval(() => {
      const from = phase === "live" ? liveAt.current : clickedAt.current;
      setElapsed(Math.floor((Date.now() - from) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    const box = transcriptBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines, partial]);

  const startCall = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) return;

    clickedAt.current = Date.now();
    setError(null);
    setLines([]);
    setPartial(null);
    setMuted(false);
    setConnectSeconds(null);
    setElapsed(0);

    // Ask for the mic up front so a blocked permission reads as its own clear step, not a slow connect.
    setPhase("mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone access is blocked. Allow it from the icon in your browser's address bar, then try again.");
      setPhase("error");
      return;
    }

    setPhase("connecting");
    try {
      const call = await vapi.start(ASSISTANT_ID, {
        // Browser audio is wideband; the assistant's default nova-2-phonecall model is tuned for 8kHz phone lines.
        transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      });
      if (!call) throw new Error("call was not created");
    } catch {
      setError("Couldn't connect to Alex. Check your connection and try again.");
      setPhase("error");
    }
  }, []);

  const endCall = useCallback(() => {
    vapiRef.current?.stop().catch(() => {});
    setPhase("ended");
  }, []);

  const toggleMute = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    const next = !vapi.isMuted();
    vapi.setMuted(next);
    setMuted(next);
  }, []);

  if (!PUBLIC_KEY || !ASSISTANT_ID) {
    return (
      <main className="flex-1 px-4 py-8 sm:px-8">
        <p className="max-w-2xl mx-auto text-red-400">
          Missing NEXT_PUBLIC_VAPI_PUBLIC_KEY or NEXT_PUBLIC_VAPI_ASSISTANT_ID. See .env.example.
        </p>
      </main>
    );
  }

  const inCall = phase === "mic" || phase === "connecting" || phase === "live";

  return (
    <main className="flex-1 px-4 py-8 sm:px-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold">Talk to Alex</h1>
        <p className="text-slate-400 text-sm mt-1">
          A live browser call with the clinic&apos;s intake agent — the same assistant that answers
          +1 (346) 998-6653.
        </p>

        <section className="mt-6 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <StatusLine
              phase={phase}
              elapsed={elapsed}
              assistantSpeaking={assistantSpeaking}
              connectSeconds={connectSeconds}
            />

            <div className="flex items-center gap-2">
              {phase === "live" && (
                <button
                  onClick={toggleMute}
                  className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-sm"
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
              )}
              {inCall ? (
                <button
                  onClick={endCall}
                  className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 text-sm font-medium"
                >
                  {phase === "live" ? "End call" : "Cancel"}
                </button>
              ) : (
                <button
                  onClick={startCall}
                  disabled={phase === "loading"}
                  className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-sm font-medium"
                >
                  {phase === "loading" ? "Getting ready…" : phase === "ready" ? "Start call" : "Call again"}
                </button>
              )}
            </div>
          </div>

          {phase === "live" && (
            <div className="mt-4 h-1 rounded-full bg-slate-800 overflow-hidden" aria-hidden>
              <div
                className="h-full bg-emerald-500 transition-[width] duration-100"
                style={{ width: `${Math.min(100, Math.round(volume * 100))}%` }}
              />
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          {phase === "ended" && (
            <p className="mt-4 text-sm text-slate-400">
              If you finished registering, the record is on the{" "}
              <Link href="/" className="text-emerald-400 hover:underline">
                patient list
              </Link>
              .
            </p>
          )}
        </section>

        <div
          ref={transcriptBox}
          className="mt-4 h-[26rem] overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/30 p-4 space-y-3"
        >
          {lines.length === 0 && !partial && (
            <p className="text-slate-500 text-sm">The conversation will show up here as you talk.</p>
          )}
          {lines.map((l, i) => (
            <Bubble key={i} line={l} />
          ))}
          {partial && <Bubble line={partial} pending />}
        </div>

        <ul className="mt-4 space-y-1 text-xs text-slate-500">
          <li>Speak naturally, and correct anything the way you would with a person (&quot;actually, it&apos;s spelled…&quot;).</li>
          <li>Use a made-up US phone number and address. Demo data only.</li>
        </ul>
      </div>
    </main>
  );
}

function StatusLine({
  phase,
  elapsed,
  assistantSpeaking,
  connectSeconds,
}: {
  phase: Phase;
  elapsed: number;
  assistantSpeaking: boolean;
  connectSeconds: number | null;
}) {
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  const content: Record<Phase, { dot: string; title: string; detail?: string }> = {
    loading: { dot: "bg-slate-500", title: "Getting ready" },
    ready: { dot: "bg-slate-400", title: "Ready", detail: "Your browser will ask for microphone access." },
    mic: { dot: "bg-amber-400 animate-pulse", title: "Waiting for microphone permission" },
    connecting: { dot: "bg-amber-400 animate-pulse", title: "Connecting to Alex", detail: `${elapsed}s` },
    live: {
      dot: assistantSpeaking ? "bg-emerald-400 animate-pulse" : "bg-emerald-500",
      title: assistantSpeaking ? "Alex is speaking" : "Listening",
      detail: connectSeconds !== null ? `${clock} · connected in ${connectSeconds.toFixed(1)}s` : clock,
    },
    ended: { dot: "bg-slate-500", title: "Call ended" },
    error: { dot: "bg-red-500", title: "Call didn't connect" },
  };
  const { dot, title, detail } = content[phase];

  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <div>
        <p className="font-medium">{title}</p>
        {detail && <p className="text-xs text-slate-400">{detail}</p>}
      </div>
    </div>
  );
}

function Bubble({ line, pending = false }: { line: Line; pending?: boolean }) {
  const isAlex = line.role === "assistant";
  return (
    <div className={`flex ${isAlex ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isAlex ? "bg-slate-800 text-slate-100" : "bg-sky-900/60 text-sky-50"
        } ${pending ? "opacity-60 italic" : ""}`}
      >
        <p className={`text-[11px] mb-0.5 ${isAlex ? "text-emerald-400" : "text-sky-300"}`}>
          {isAlex ? "Alex" : "You"}
        </p>
        {line.text}
      </div>
    </div>
  );
}
