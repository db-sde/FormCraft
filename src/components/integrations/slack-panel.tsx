"use client";

import { useState, useTransition } from "react";
import { Send, Trash2 } from "lucide-react";
import {
  createSlackAction,
  deleteWebhookEndpointAction,
  sendTestDeliveryAction,
  setSlackQuestionsAction,
  setWebhookEnabledAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import type { WebhookEndpoint } from "@/domains/webhooks/queries";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { cn } from "cn";

type Question = { id: string; number: number; label: string };

function QuestionPicker({
  questions,
  value,
  onChange,
}: {
  questions: Question[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-semibold">
        Answers in the message{" "}
        <span className="text-muted-foreground font-normal">
          (none picked = the first ten answered; up to ten)
        </span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q) => {
          const on = value.includes(q.id);
          return (
            <button
              key={q.id}
              type="button"
              aria-pressed={on}
              disabled={!on && value.length >= 10}
              onClick={() =>
                onChange(on ? value.filter((id) => id !== q.id) : [...value, q.id])
              }
              className={cn(
                "fc-focus rounded-full border-[1.5px] px-2.5 py-1 text-[12.5px] font-semibold",
                on
                  ? "border-ink bg-primary text-primary-foreground"
                  : "border-input hover:bg-hover-wash disabled:opacity-40",
              )}
            >
              {q.number} · {q.label.slice(0, 28)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Slack (P2.14): new responses posted to a channel through a Slack
 * incoming webhook. File answers are never linked (uploads are private). */
export function SlackPanel({
  formId,
  endpoints,
  questions,
  allowed,
}: {
  formId: string;
  endpoints: WebhookEndpoint[];
  questions: Question[];
  /** The plan includes Slack. */
  allowed: boolean;
}) {
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();

  if (!allowed) {
    return (
      <p className="text-muted-foreground text-sm">
        Slack is part of the Business plan. See Settings → Plan.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {endpoints.map((endpoint) => (
        <div
          key={endpoint.id}
          className="border-ink bg-card flex flex-col gap-3 rounded-lg border-[1.5px] p-3.5"
        >
          <div className="flex items-center gap-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
              {endpoint.url.replace(/\/[^/]+$/, "/•••")}
            </span>
            <Switch
              aria-label="Send to Slack"
              checked={endpoint.enabled}
              onCheckedChange={(on) =>
                start(() => setWebhookEnabledAction(formId, endpoint.id, on))
              }
            />
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await sendTestDeliveryAction(endpoint.id);
                  if (result.ok) toast.success("Test message sent to Slack.");
                  else
                    toast.error("Slack didn't accept the test.", {
                      description: result.error,
                    });
                })
              }
            >
              <Send /> Test
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Disconnect Slack"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Stop sending responses to this Slack channel?")) {
                  start(() => deleteWebhookEndpointAction(formId, endpoint.id));
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
          <QuestionPicker
            questions={questions}
            value={endpoint.questionIds}
            onChange={(next) =>
              start(async () => {
                const result = await setSlackQuestionsAction(formId, endpoint.id, next);
                if (!result.ok) toast.error(result.message);
              })
            }
          />
        </div>
      ))}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const result = await createSlackAction(formId, url, picked);
            if (result.ok) {
              setUrl("");
              setPicked([]);
              toast.success("Slack connected. Send a test to check it.");
            } else toast.error(result.message);
          });
        }}
      >
        <p className="text-muted-foreground text-[13px]">
          In Slack, add the “Incoming WebHooks” app to the channel you want, then paste
          its URL here.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Slack webhook URL"
            value={url}
            placeholder="https://hooks.slack.com/services/…"
            onChange={(e) => setUrl(e.target.value)}
            className="h-[38px] flex-1"
          />
          <Button type="submit" disabled={pending || !url.trim()}>
            {pending && <ButtonSpinner />}
            Connect Slack
          </Button>
        </div>
        {questions.length > 0 && (
          <QuestionPicker questions={questions} value={picked} onChange={setPicked} />
        )}
      </form>
    </div>
  );
}
