"use client";

import { useEffect, useImperativeHandle, useRef } from "react";

/** The slice of Cloudflare's widget API this page uses. */
type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      appearance?: "always" | "execute" | "interaction-only";
      "refresh-expired"?: "auto" | "manual" | "never";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => boolean | void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page. The page's CSP allows it
 * on published forms; being added by a nonce'd script is what lets it
 * run under 'strict-dynamic'. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile"));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = {
  /** The current token, if the check has passed and it hasn't expired. */
  token: () => string | null;
  /** A fresh check, after the server used or refused the last token. */
  reset: () => void;
};

/**
 * Cloudflare Turnstile for forms that require a CAPTCHA (master spec
 * F-26). It runs in the background from page load and only shows itself
 * when Cloudflare wants the person to interact, so most people never
 * see it. The token goes with the submit; the server verifies it.
 */
export function Turnstile({
  siteKey,
  ref,
}: {
  siteKey: string;
  ref: React.Ref<TurnstileHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    token: () => tokenRef.current,
    reset: () => {
      tokenRef.current = null;
      if (widgetRef.current && window.turnstile)
        window.turnstile.reset(widgetRef.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || !containerRef.current || widgetRef.current) return;
        widgetRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          "refresh-expired": "auto",
          callback: (token) => {
            tokenRef.current = token;
          },
          "expired-callback": () => {
            tokenRef.current = null;
          },
          "error-callback": () => {
            tokenRef.current = null;
          },
        });
      },
      () => {
        // No token: the submit says so, and the person can retry.
      },
    );
    return () => {
      cancelled = true;
      if (widgetRef.current && window.turnstile) {
        window.turnstile.remove(widgetRef.current);
      }
      widgetRef.current = null;
    };
  }, [siteKey]);

  return (
    <div
      ref={containerRef}
      data-testid="turnstile"
      className="absolute bottom-[56px] left-1/2 z-10 -translate-x-1/2"
    />
  );
}
