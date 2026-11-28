"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Mic, RotateCcw, Square, Video } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { cn } from "cn";
import { beginPendingSave } from "./pending-saves";

type MediaQuestion = Extract<QuestionV1, { type: "media" }>;

type Phase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "recording"; startedAt: number }
  | { kind: "saving"; url: string }
  | { kind: "saved"; url: string | null }
  | { kind: "error"; message: string; url?: string };

/** What MediaRecorder can make here, best first. */
function recorderType(kind: "audio" | "video"): string | undefined {
  const candidates =
    kind === "video"
      ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find(
    (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
  );
}

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function deviceProblem(error: unknown, kind: "audio" | "video"): string {
  const device = kind === "video" ? "camera and microphone" : "microphone";
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Recording needs your ${device}. Allow it in your browser's settings, then try again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `No ${device} was found on this device.`;
  }
  if (name === "NotReadableError") {
    return `Your ${device} is in use by another app. Close it and try again.`;
  }
  return "Recording couldn't start. Try again, or use another browser.";
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * A video or audio answer recorded in the browser (roadmap #21). They
 * agree to the recording first; the camera or microphone is only asked
 * for when they press Record, and is turned off as soon as they stop.
 * The recording stops by itself at the question's limit, plays back for
 * them to check, and uploads; recording again replaces it.
 */
export function MediaInput({
  question,
  value,
  onChange,
  getResponseId,
  idPrefix,
}: {
  question: MediaQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  getResponseId?: () => Promise<string>;
  idPrefix: string;
}) {
  const { kind, maxSeconds } = question.settings;
  const consentText =
    question.settings.consentText?.trim() ||
    "I agree to this recording being sent with my answers.";
  const [agreed, setAgreed] = useState(typeof value === "string");
  const [phase, setPhase] = useState<Phase>(() =>
    typeof value === "string" ? { kind: "saved", url: null } : { kind: "idle" },
  );
  const [elapsed, setElapsed] = useState(0);
  const [supported] = useState(canRecord);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const live = useRef<HTMLVideoElement | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const urls = useRef<string[]>([]);
  // Leaving mid-recording throws the recording away.
  const gone = useRef(false);

  function release() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    clearTimeout(stopTimer.current ?? undefined);
    clearInterval(tick.current ?? undefined);
  }

  // Off when they leave the question or the page.
  useEffect(
    () => () => {
      gone.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  async function upload(blob: Blob, url: string) {
    if (!getResponseId) {
      // Builder preview: nothing is sent.
      onChange("preview-media");
      setPhase({ kind: "saved", url });
      return;
    }
    const end = beginPendingSave();
    setPhase({ kind: "saving", url });
    try {
      const responseId = await getResponseId();
      const body = new FormData();
      const ext = blob.type.includes("mp4")
        ? kind === "audio"
          ? "m4a"
          : "mp4"
        : blob.type.includes("ogg")
          ? "ogg"
          : "webm";
      body.set("file", new File([blob], `recording.${ext}`, { type: blob.type }));
      const res = await fetch(`/api/responses/${responseId}/uploads/${question.id}`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? "refused");
      }
      const data = (await res.json()) as { uploadId: string };
      onChange(data.uploadId);
      setPhase({ kind: "saved", url });
    } catch (error) {
      onChange(undefined);
      const message =
        error instanceof Error && error.message !== "refused" ? error.message : null;
      setPhase({
        kind: "error",
        url,
        message: message
          ? `The recording couldn't be saved: ${message}`
          : "The recording couldn't be saved. Check your connection and record again.",
      });
    } finally {
      end();
    }
  }

  async function start() {
    setPhase({ kind: "asking" });
    try {
      const media = await navigator.mediaDevices.getUserMedia(
        kind === "video"
          ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { audio: true },
      );
      stream.current = media;
      const type = recorderType(kind);
      const rec = new MediaRecorder(media, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: 96_000,
        ...(kind === "video" ? { videoBitsPerSecond: 1_500_000 } : {}),
      });
      recorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        release();
        if (gone.current) return;
        const blob = new Blob(chunks.current, {
          type: rec.mimeType || type || `${kind}/webm`,
        });
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        void upload(blob, url);
      };
      if (live.current && kind === "video") {
        live.current.srcObject = media;
        void live.current.play().catch(() => undefined);
      }
      rec.start(1000);
      const startedAt = Date.now();
      setElapsed(0);
      setPhase({ kind: "recording", startedAt });
      tick.current = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);
      stopTimer.current = setTimeout(() => stop(), maxSeconds * 1000);
    } catch (error) {
      release();
      setPhase({ kind: "error", message: deviceProblem(error, kind) });
    }
  }

  function stop() {
    clearTimeout(stopTimer.current ?? undefined);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  if (!supported) {
    return (
      <p role="alert" className="max-w-(--st-tile-max) text-[14px] text-(--st-muted)">
        This browser can&apos;t record {kind === "video" ? "video" : "audio"}. Open this
        form in an up-to-date Chrome, Edge, Firefox or Safari to answer.
      </p>
    );
  }

  const recording = phase.kind === "recording";
  const playback = "url" in phase ? phase.url : undefined;
  const Icon = kind === "video" ? Video : Mic;

  return (
    <div className="flex max-w-(--st-tile-max) flex-col gap-3">
      <label className="flex items-start gap-2.5 text-[14.5px]">
        <input
          id={`${idPrefix}-consent`}
          type="checkbox"
          checked={agreed}
          disabled={recording || phase.kind === "asking"}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 size-4 accent-(--st-primary)"
        />
        <span>{consentText}</span>
      </label>

      {kind === "video" && (recording || phase.kind === "asking") && (
        <video
          ref={live}
          muted
          playsInline
          aria-label="Your camera"
          className="aspect-video w-full rounded-(--st-tile-br) border-[1.5px] border-(--st-line) bg-black object-cover"
        />
      )}

      {playback &&
        !recording &&
        (kind === "video" ? (
          <video
            src={playback}
            controls
            playsInline
            aria-label="Your recording"
            className="aspect-video w-full rounded-(--st-tile-br) border-[1.5px] border-(--st-line) bg-black"
          />
        ) : (
          <audio src={playback} controls aria-label="Your recording" className="w-full" />
        ))}

      <div className="flex flex-wrap items-center gap-2.5">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="fc-focus inline-flex items-center gap-2 rounded-(--st-br) border-[1.5px] border-(--st-primary) bg-(--st-sel) px-4 py-2 text-[14.5px] font-semibold"
          >
            <Square aria-hidden className="size-3.5 fill-current" /> Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!agreed || phase.kind === "asking" || phase.kind === "saving"}
            onClick={() => void start()}
            className={cn(
              "fc-focus inline-flex items-center gap-2 rounded-(--st-br) border-[1.5px] px-4 py-2 text-[14.5px] font-semibold disabled:opacity-50",
              "border-(--st-line) bg-(--st-field)",
            )}
          >
            {phase.kind === "saved" || phase.kind === "error" ? (
              <>
                <RotateCcw aria-hidden className="size-3.5" /> Record again
              </>
            ) : (
              <>
                <Icon aria-hidden className="size-4" /> Record{" "}
                {kind === "video" ? "video" : "audio"}
              </>
            )}
          </button>
        )}
        <span
          role="status"
          aria-live="polite"
          className="text-[13.5px] text-(--st-muted)"
        >
          {recording ? (
            <span className="inline-flex items-center gap-1.5">
              <Circle
                aria-hidden
                className="size-2.5 animate-pulse fill-red-600 text-red-600"
              />
              Recording {clock(elapsed)} of {clock(maxSeconds)}
            </span>
          ) : phase.kind === "asking" ? (
            `Waiting for your ${kind === "video" ? "camera" : "microphone"}…`
          ) : phase.kind === "saving" ? (
            "Saving your recording…"
          ) : phase.kind === "saved" ? (
            playback ? (
              "Recording saved. Play it back, or record again to replace it."
            ) : (
              "Recorded earlier. Record again to replace it."
            )
          ) : phase.kind === "idle" ? (
            agreed ? (
              `Up to ${clock(maxSeconds)}.`
            ) : (
              `Tick the box to start. Up to ${clock(maxSeconds)}.`
            )
          ) : null}
        </span>
      </div>
      {phase.kind === "error" && (
        <p role="alert" className="text-[14px] text-(--st-error,#b42318)">
          {phase.message}
        </p>
      )}
    </div>
  );
}
