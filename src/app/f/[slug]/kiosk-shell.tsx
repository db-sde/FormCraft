"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, Maximize2 } from "lucide-react";
import type { KioskConfig } from "@/domains/forms/kiosk";
import { KIOSK_PARAM } from "@/domains/forms/kiosk";
import { PublicFormRuntime } from "./public-form-runtime";

/** How long "Still there?" waits before starting over. */
const STILL_THERE_SECONDS = 15;

type RuntimeProps = Omit<
  React.ComponentProps<typeof PublicFormRuntime>,
  "kiosk" | "onCompleted"
>;

/**
 * Kiosk mode (master spec F-15) around the public form: one device, one
 * person after another. Each person gets a brand-new form (the runtime is
 * remounted, so no answer, position or seed carries over); after a submit
 * the ending shows for `resetSeconds`, and after `idleSeconds` without a
 * touch "Still there?" counts down and starts over. The exit control asks
 * for the PIN, checked on the server; it guards leaving kiosk mode here,
 * not the device itself.
 */
export function KioskShell({
  config,
  hasPin,
  runtime,
}: {
  config: KioskConfig;
  hasPin: boolean;
  runtime: RuntimeProps;
}) {
  const [session, setSession] = useState(0);
  const [started, setStarted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [stillThere, setStillThere] = useState<number | null>(null);
  const [exiting, setExiting] = useState(false);
  const lastActivity = useRef(0);
  const touched = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startOver = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
    touched.current = false;
    setStillThere(null);
    setSession((n) => n + 1);
    window.scrollTo(0, 0);
  }, []);

  // Touches, keys and typing count as someone being there.
  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
      touched.current = true;
      setStillThere((s) => (s === null ? s : null));
    };
    const events = ["pointerdown", "keydown", "input", "wheel", "touchstart"] as const;
    for (const e of events) document.addEventListener(e, mark, { passive: true });
    return () => {
      for (const e of events) document.removeEventListener(e, mark);
    };
  }, []);

  // Idle: once someone has started, a quiet spell asks "Still there?",
  // then starts over.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!touched.current || exiting) return;
      const idle = (Date.now() - lastActivity.current) / 1000;
      if (idle < config.idleSeconds) return;
      setStillThere((s) => {
        const left = s === null ? STILL_THERE_SECONDS : s - 1;
        if (left <= 0) {
          queueMicrotask(startOver);
          return null;
        }
        return left;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [config.idleSeconds, exiting, startOver]);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keep the screen on while the kiosk runs, where the browser allows it.
  useEffect(() => {
    if (!started) return;
    let lock: { release: () => Promise<void> } | null = null;
    const wake = (
      navigator as { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } }
    ).wakeLock;
    void wake?.request("screen").then(
      (l) => (lock = l),
      () => undefined,
    );
    return () => void lock?.release().catch(() => undefined);
  }, [started]);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Some browsers (iPhone) don't allow it; the kiosk works anyway.
    }
  }

  function leave() {
    void document.exitFullscreen?.().catch(() => undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete(KIOSK_PARAM);
    window.location.assign(url.toString());
  }

  if (!started) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#f5efe4] p-6 text-[#2b2118]">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="font-heading text-3xl font-bold">Kiosk mode</h1>
          <p className="text-[15px] leading-normal text-[#6f6254]">
            Each person gets a fresh form. After they submit, or after{" "}
            {config.idleSeconds} seconds without a touch, it starts again for the next.
            Nothing anyone types stays on this device.
          </p>
          <button
            type="button"
            onClick={() => {
              setStarted(true);
              void enterFullscreen();
            }}
            className="h-12 rounded-[8px] bg-[#2b2118] px-6 text-[15px] font-semibold text-[#fffaf1]"
          >
            Start kiosk
          </button>
          <p className="text-xs text-[#6f6254]">
            This doesn&apos;t lock the device. For that, use its own setting (Guided
            Access on iPad, screen pinning on Android).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-kiosk>
      <PublicFormRuntime
        key={session}
        {...runtime}
        kiosk
        onCompleted={() => {
          resetTimer.current = setTimeout(startOver, config.resetSeconds * 1000);
        }}
      />
      <div className="fixed top-2 right-2 z-50 flex gap-1.5 opacity-40 focus-within:opacity-100 hover:opacity-100">
        {!fullscreen && (
          <button
            type="button"
            aria-label="Full screen"
            onClick={() => void enterFullscreen()}
            className="grid size-9 place-items-center rounded-full bg-white/80 text-[#2b2118] shadow-sm"
          >
            <Maximize2 className="size-4" />
          </button>
        )}
        <button
          type="button"
          aria-label="Exit kiosk mode"
          onClick={() => (hasPin ? setExiting(true) : leave())}
          className="grid size-9 place-items-center rounded-full bg-white/80 text-[#2b2118] shadow-sm"
        >
          <LogOut className="size-4" />
        </button>
      </div>
      {stillThere !== null && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="kiosk-still-there"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
        >
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-[12px] bg-white p-6 text-center text-[#2b2118]">
            <h2 id="kiosk-still-there" className="text-xl font-bold">
              Still there?
            </h2>
            <p className="text-[15px]">
              The form starts over for the next person in {stillThere} second
              {stillThere === 1 ? "" : "s"}, and what was typed is cleared.
            </p>
            <button
              type="button"
              autoFocus
              onClick={() => {
                lastActivity.current = Date.now();
                setStillThere(null);
              }}
              className="h-11 rounded-[8px] bg-[#2b2118] px-5 font-semibold text-[#fffaf1]"
            >
              I&apos;m still here
            </button>
          </div>
        </div>
      )}
      {exiting && (
        <PinDialog
          formId={runtime.formId}
          onCancel={() => setExiting(false)}
          onUnlocked={leave}
        />
      )}
    </div>
  );
}

function PinDialog({
  formId,
  onCancel,
  onUnlocked,
}: {
  formId: string;
  onCancel: () => void;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kiosk-exit-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setChecking(true);
          setError(null);
          const res = await fetch("/api/responses/kiosk-exit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formId, pin }),
          }).catch(() => null);
          setChecking(false);
          if (res?.ok) return onUnlocked();
          setPin("");
          setError(
            res?.status === 429
              ? "Too many tries. Wait a few minutes."
              : "That PIN isn't right.",
          );
        }}
        className="flex w-full max-w-xs flex-col gap-3 rounded-[12px] bg-white p-6 text-[#2b2118]"
      >
        <h2 id="kiosk-exit-title" className="text-lg font-bold">
          Exit kiosk mode
        </h2>
        <label htmlFor="kiosk-pin" className="text-sm">
          PIN
        </label>
        <input
          id="kiosk-pin"
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          type="password"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="h-11 rounded-[8px] border-[1.5px] border-[#2b2118] px-3 text-lg tracking-[0.3em]"
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-[#c8372d]">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 flex-1 rounded-[8px] border-[1.5px] border-[#2b2118] font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={checking || pin.length < 4}
            className="h-10 flex-1 rounded-[8px] bg-[#2b2118] font-semibold text-[#fffaf1] disabled:opacity-50"
          >
            {checking ? "Checking…" : "Exit"}
          </button>
        </div>
      </form>
    </div>
  );
}
