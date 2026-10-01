"use client";

import { Flag, Palette } from "lucide-react";
import type { EndingV1, QuestionV1, ThemeV1 } from "@/domains/forms/schema/v1";
import { RuntimeQuestionInput } from "@/components/runtime/runtime-question-input";
import {
  Stage,
  StageActions,
  StageButton,
  StageNumber,
  stageDescClass,
  stageLabelClass,
  stageTitleClass,
} from "@/components/runtime/stage";
import { QUESTION_TYPE_META, TypeTile } from "./question-meta";
import { cn } from "cn";

/** Text edited in place on the stage: auto-sizing, no chrome until
 * focused, then a ring in the theme's primary colour. */
const EDITABLE =
  "-mx-1.5 block w-auto max-w-full min-w-10 resize-none rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 [field-sizing:content] outline-none placeholder:text-current placeholder:opacity-40 focus:bg-white/35 focus:shadow-[0_0_0_2px_var(--st-primary)] focus-visible:shadow-[0_0_0_2px_var(--st-primary)]";

const SAMPLE_QUESTION = {
  id: "sample",
  type: "single_select",
  label: "How did you hear about us?",
  description: "A sample question, styled with your theme.",
  required: true,
  order: 0,
  settings: {
    options: [
      { id: "a", label: "A friend or colleague" },
      { id: "b", label: "Search engine" },
      { id: "c", label: "A podcast" },
    ],
    allowOther: false,
  },
} as unknown as QuestionV1;

type CanvasItem =
  | {
      kind: "question";
      question: QuestionV1;
      number: number;
      total: number;
      isLast: boolean;
    }
  | { kind: "ending"; ending: EndingV1 }
  | { kind: "theme" };

/** The builder's centre (Part 4): the selected step on the respondent
 * stage, label and description editable in place, the answer control
 * drawn but inert. */
export function BuilderCanvas({
  theme,
  item,
  onChangeQuestion,
  onChangeEnding,
}: {
  theme: ThemeV1;
  item: CanvasItem;
  onChangeQuestion: (next: QuestionV1) => void;
  onChangeEnding: (next: EndingV1) => void;
}) {
  let chip: React.ReactNode;
  let typeLabel: string;
  let hint: string;
  let required: string | null = null;
  let foot: string;

  if (item.kind === "question") {
    const q = item.question;
    chip = <TypeTile type={q.type} size={20} bordered={false} />;
    typeLabel = QUESTION_TYPE_META[q.type].label;
    hint = "Click the text to edit it.";
    if (
      q.type !== "welcome_screen" &&
      q.type !== "statement" &&
      q.type !== "contact_info"
    ) {
      required = q.required ? "Required" : "Optional";
    }
    foot =
      q.type === "welcome_screen" || q.type === "statement"
        ? "Use Preview to try the real form."
        : "This is a preview of the answer control and can’t be clicked. Use Preview to try the real form.";
  } else if (item.kind === "ending") {
    chip = (
      <span className="grid size-5 place-items-center rounded-[5px] bg-[var(--qt-screens-bg)] text-[var(--qt-screens-fg)]">
        <Flag className="size-3" />
      </span>
    );
    typeLabel = item.ending.isDefault ? "Default ending" : "Ending";
    hint = "Shown after the last question, or when a rule sends people here.";
    foot = item.ending.redirectUrl
      ? `The button goes to ${item.ending.redirectUrl}`
      : "Add a redirect URL to show a button that takes people somewhere next.";
  } else {
    chip = (
      <span className="grid size-5 place-items-center rounded-[5px] bg-[var(--qt-scale-bg)] text-[var(--qt-scale-fg)]">
        <Palette className="size-3" />
      </span>
    );
    typeLabel = "Theme preview";
    hint = "This is what your theme looks like.";
    foot = "Showing a sample question with one option selected.";
  }

  return (
    <div className="flex min-h-full flex-col items-center gap-3.5 px-9 py-7">
      <div className="flex w-full max-w-[880px] items-center gap-2.5">
        <span className="border-ink bg-card flex items-center gap-2 rounded-full border-[1.5px] py-[5px] pr-2.5 pl-1.5 text-[11.5px] font-bold tracking-[0.1em] uppercase">
          {chip}
          {typeLabel}
        </span>
        <span className="text-muted-foreground truncate text-[13px]">{hint}</span>
        <span className="flex-1" />
        {required && (
          <span className="text-muted-foreground text-[12.5px] font-semibold">
            {required}
          </span>
        )}
      </div>

      <div className="border-ink shadow-lift aspect-[4/3] max-h-[calc(100dvh-190px)] min-h-[460px] w-full max-w-[860px] overflow-hidden rounded-lg border-[1.5px] bg-white">
        {item.kind === "question" && (
          <QuestionStage
            theme={theme}
            question={item.question}
            number={item.number}
            total={item.total}
            isLast={item.isLast}
            onChange={onChangeQuestion}
          />
        )}
        {item.kind === "ending" && (
          <EndingStage theme={theme} ending={item.ending} onChange={onChangeEnding} />
        )}
        {item.kind === "theme" && (
          <Stage theme={theme} mode="canvas" progress={0.3} className="size-full">
            <StageNumber n={3} />
            <div className="flex flex-col gap-2">
              <h2 className={stageLabelClass}>
                {SAMPLE_QUESTION.label}
                <span aria-hidden className="text-(--st-primary)">
                  {" "}
                  *
                </span>
              </h2>
              <p className={stageDescClass}>{SAMPLE_QUESTION.description}</p>
            </div>
            <RuntimeQuestionInput
              question={SAMPLE_QUESTION}
              value="a"
              onChange={() => undefined}
              preview
            />
            <StageActions
              showBack={false}
              label="OK"
              showCheck
              inert
              enterHint="press Enter ↵"
            />
          </Stage>
        )}
      </div>

      <span className="text-muted-foreground text-center text-[12.5px]">{foot}</span>
    </div>
  );
}

function QuestionStage({
  theme,
  question,
  number,
  total,
  isLast,
  onChange,
}: {
  theme: ThemeV1;
  question: QuestionV1;
  number: number;
  total: number;
  isLast: boolean;
  onChange: (next: QuestionV1) => void;
}) {
  const entry = question.type === "welcome_screen" || question.type === "statement";
  const label = (
    <textarea
      key={`l-${question.id}`}
      rows={1}
      value={question.label}
      placeholder="Question text"
      aria-label="Question text"
      onChange={(e) => onChange({ ...question, label: e.target.value })}
      className={cn(EDITABLE, entry ? stageTitleClass : stageLabelClass)}
    />
  );
  const description = (
    <textarea
      key={`d-${question.id}`}
      rows={1}
      value={question.description ?? ""}
      placeholder="Description (optional)"
      aria-label="Description"
      onChange={(e) => onChange({ ...question, description: e.target.value })}
      className={cn(EDITABLE, stageDescClass, "max-w-[520px]")}
    />
  );

  if (entry) {
    const buttonLabel =
      question.settings.buttonLabel ||
      (isLast ? "Submit" : question.type === "statement" ? "Continue" : "Start");
    return (
      <Stage
        theme={theme}
        mode="canvas"
        progress={question.type === "welcome_screen" ? 0 : number / Math.max(total, 1)}
        className="size-full"
      >
        <div className="flex flex-col gap-4">
          {question.settings.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- creator-uploaded Supabase Storage URL
            <img
              src={question.settings.imageUrl}
              alt={question.settings.imageAlt ?? ""}
              className="max-h-48 w-full rounded-(--st-tile-br) object-contain"
            />
          )}
          {label}
          {description}
          <div className="mt-2 flex items-center gap-3">
            <StageButton
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none px-[26px]"
            >
              {buttonLabel}
            </StageButton>
            <span className="text-[12.5px] text-(--st-muted)">press Enter ↵</span>
          </div>
        </div>
      </Stage>
    );
  }

  return (
    <Stage
      theme={theme}
      mode="canvas"
      progress={number / Math.max(total, 1)}
      className="size-full"
    >
      <StageNumber n={number} />
      <div className="flex flex-col gap-2">
        <div className="flex items-start">
          {label}
          {question.required && question.type !== "contact_info" && (
            <span aria-hidden className={cn(stageLabelClass, "pl-1 text-(--st-primary)")}>
              *
            </span>
          )}
        </div>
        {description}
      </div>
      <RuntimeQuestionInput
        key={question.id}
        question={question}
        value={undefined}
        onChange={() => undefined}
        preview
      />
      <StageActions
        showBack={false}
        label={isLast ? "Submit" : "OK"}
        showCheck={!isLast}
        inert
        enterHint={
          question.type === "long_text"
            ? "Shift ⇧ + Enter ↵ for a new line"
            : "press Enter ↵"
        }
      />
    </Stage>
  );
}

function EndingStage({
  theme,
  ending,
  onChange,
}: {
  theme: ThemeV1;
  ending: EndingV1;
  onChange: (next: EndingV1) => void;
}) {
  return (
    <Stage
      theme={theme}
      mode="canvas"
      progress={1}
      madeWith={ending.showMadeWith !== false}
      className="size-full"
    >
      <div className="flex flex-col items-start gap-4 pb-10">
        <textarea
          key={`l-${ending.id}`}
          rows={1}
          value={ending.title}
          placeholder="Thank you!"
          aria-label="Ending title"
          onChange={(e) => onChange({ ...ending, title: e.target.value })}
          className={cn(EDITABLE, stageTitleClass)}
        />
        <textarea
          key={`d-${ending.id}`}
          rows={1}
          value={ending.description ?? ""}
          placeholder="Description (optional)"
          aria-label="Ending description"
          onChange={(e) => onChange({ ...ending, description: e.target.value })}
          className={cn(EDITABLE, stageDescClass, "max-w-[460px]")}
        />
        {ending.redirectUrl && (
          <StageButton
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none mt-2 px-[26px]"
          >
            {ending.buttonLabel || "Continue"}
          </StageButton>
        )}
      </div>
    </Stage>
  );
}
