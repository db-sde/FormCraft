"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { cn } from "cn";

type EmailQuestion = Extract<QuestionV1, { type: "email" }>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * An email question that confirms the address with a code (roadmap #8).
 * The answer stays empty until the code sent to the address is entered,
 * so a required question won't move on before that; changing the address
 * afterwards empties it again. The server checks it all again on submit.
 */
export function EmailVerifyInput({
  question,
  value,
  onChange,
  getResponseId,
  autoFocus,
  className,
}: {
  question: EmailQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  getResponseId?: () => Promise<string>;
  autoFocus?: boolean;
  className: string;
}) {
  const [typed, setTyped] = useState(typeof value === "string" ? value : "");
  const [verifiedAs, setVerifiedAs] = useState<string | null>(
    typeof value === "string" && value ? value.trim().toLowerCase() : null,
  );
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const address = typed.trim().toLowerCase();
  const verified = verifiedAs !== null && verifiedAs === address;
  const preview = !getResponseId;

  async function call(method: "POST" | "PUT", body: Record<string, string>) {
    const responseId = await getResponseId!();
    const res = await fetch(`/api/responses/${responseId}/email-code`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: question.id, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      email?: string;
      error?: { message?: string };
    };
    return { ok: res.ok, data };
  }

  async function sendCode() {
    if (preview || !EMAIL.test(address)) {
      setMessage({
        text: preview
          ? "Respondents get a code by email here. Preview doesn't send one."
          : "Enter a valid email address first.",
        error: !preview,
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await call("POST", { email: address });
      if (ok) {
        setSentTo(address);
        setCode("");
        setMessage({ text: `We sent a 6-digit code to ${address}.`, error: false });
      } else {
        setMessage({
          text: data.error?.message ?? "Couldn't send a code. Try again.",
          error: true,
        });
      }
    } catch {
      setMessage({ text: "Couldn't send a code. Check your connection.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function checkCode() {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await call("PUT", { code });
      if (ok && data.email) {
        setVerifiedAs(data.email);
        setSentTo(null);
        onChange(typed.trim());
        setMessage(null);
      } else {
        setMessage({
          text: data.error?.message ?? "That code isn't right.",
          error: true,
        });
      }
    } catch {
      setMessage({
        text: "Couldn't check the code. Check your connection.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const button =
    "fc-focus inline-flex items-center rounded-(--st-br) border-[1.5px] border-(--st-line) bg-(--st-field) px-3.5 py-1.5 text-[14px] font-semibold disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      <input
        autoFocus={autoFocus}
        type="email"
        autoComplete="email"
        value={typed}
        aria-label={question.label}
        aria-describedby={`${question.id}-verify-status`}
        onChange={(e) => {
          setTyped(e.target.value);
          const next = e.target.value.trim().toLowerCase();
          // A changed address needs its own code.
          if (next !== verifiedAs) onChange(preview ? e.target.value : undefined);
          else onChange(e.target.value);
          if (sentTo && next !== sentTo) setSentTo(null);
        }}
        placeholder="name@example.com"
        className={className}
      />
      <div
        id={`${question.id}-verify-status`}
        className="flex flex-wrap items-center gap-2.5"
      >
        {verified ? (
          <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold">
            <CheckCircle2 aria-hidden className="size-4 text-(--st-primary)" /> Email
            confirmed
          </span>
        ) : sentTo === address ? (
          <>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (code.length === 6) void checkCode();
                }
              }}
              placeholder="123456"
              className="w-[8.5ch] rounded-(--st-br) border-[1.5px] border-(--st-line) bg-(--st-field) px-2.5 py-1.5 text-center font-mono text-[16px] tracking-[0.2em]"
            />
            <button
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => void checkCode()}
              className={button}
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendCode()}
              className="text-[13.5px] text-(--st-muted) underline underline-offset-2"
            >
              Send a new code
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !address}
            onClick={() => void sendCode()}
            className={button}
          >
            Send code
          </button>
        )}
      </div>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn(
            "text-[14px]",
            message.error ? "text-(--st-error,#b42318)" : "text-(--st-muted)",
          )}
        >
          {message.text}
        </p>
      )}
      {!verified && !message && (
        <p className="text-[13.5px] text-(--st-muted)">
          We&apos;ll email you a code to confirm this address.
        </p>
      )}
    </div>
  );
}
