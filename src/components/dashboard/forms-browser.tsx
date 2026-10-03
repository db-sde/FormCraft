"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStoredValue } from "@/lib/hooks/use-stored-value";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, LayoutGrid, List, Plus, Search, X } from "lucide-react";
import type { FormListItem, PublishState } from "@/domains/forms";
import { createFormAction } from "@/app/(dashboard)/actions";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { LocalTime } from "@/components/local-time";
import { FormPreviewArt } from "@/components/forms/form-preview-art";
import { CanEditContext, FoldersContext, FormActionsMenu } from "./form-actions-menu";
import { FolderBar, type FolderFilter } from "./folder-bar";

type Filter = "all" | "live" | "draft";
type Sort = "edited" | "created" | "name" | "responses";
type View = "grid" | "list";

const SORTS: [Sort, string][] = [
  ["edited", "Last edited"],
  ["created", "Date created"],
  ["name", "Name (A–Z)"],
  ["responses", "Most responses"],
];

const STATUS: Record<PublishState, { tone: ChipTone; label: string }> = {
  live: { tone: "live", label: "Live" },
  draft: { tone: "draft", label: "Draft" },
  unpublished: { tone: "pending", label: "Unpublished" },
};

const VIEW_KEY = "fc-forms-view";

function meta(form: FormListItem) {
  return (
    <>
      {form.responseCount > 0 ? (
        // Straight to the responses: above the card's own link (which
        // opens the builder), so it's one click from the dashboard.
        <Link
          href={`/forms/${form.id}/responses`}
          className="fc-focus text-foreground relative z-10 rounded-xs font-semibold underline decoration-[var(--border)] underline-offset-[3px] hover:decoration-current"
        >
          {form.responseCount.toLocaleString()} response
          {form.responseCount === 1 ? "" : "s"}
        </Link>
      ) : (
        "No responses yet"
      )}{" "}
      · Edited <LocalTime iso={form.updatedAt} variant="relative" />
    </>
  );
}

function FormCard({
  form,
  onDuplicating,
}: {
  form: FormListItem;
  onDuplicating?: (pending: boolean) => void;
}) {
  const status = STATUS[form.publishState];
  return (
    <div className="group border-ink bg-card shadow-card hover:shadow-lift relative rounded-lg border-[1.5px] transition-[transform,box-shadow] duration-[80ms] hover:-translate-x-px hover:-translate-y-px">
      <FormPreviewArt
        preview={form.preview}
        className="border-ink h-[136px] rounded-t-[8.5px] border-b-[1.5px]"
      />
      <StatusChip
        tone={status.tone}
        size="sm"
        className="absolute top-3 right-3.5 rotate-[4deg] text-[11px] tracking-[0.06em]"
      >
        {status.label}
      </StatusChip>
      <div className="flex items-start gap-2.5 p-[18px]">
        <div className="min-w-0 flex-1">
          {/* The whole card opens the builder via this link's ::after;
              the ⋯ menu sits above it. */}
          <Link
            href={`/forms/${form.id}`}
            className="font-heading focus-visible:after:shadow-focus block truncate text-[17px] leading-[1.3] font-bold tracking-[-0.01em] outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {form.title}
          </Link>
          <p className="text-muted-foreground mt-1.5 truncate text-[13px]">
            {meta(form)}
          </p>
        </div>
        <FormActionsMenu form={form} onDuplicating={onDuplicating} />
      </div>
    </div>
  );
}

function DuplicatingCard({ title }: { title: string }) {
  return (
    <div className="border-ink bg-card shadow-card rounded-lg border-[1.5px] opacity-60">
      <div className="border-ink bg-muted h-[136px] rounded-t-[8.5px] border-b-[1.5px]" />
      <div className="p-[18px]">
        <div className="font-heading truncate text-[17px] font-bold">{title} (copy)</div>
        <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-[13px]">
          <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Duplicating…
        </p>
      </div>
    </div>
  );
}

function FormListRow({ form }: { form: FormListItem }) {
  const status = STATUS[form.publishState];
  return (
    <div className="border-border hover:bg-accent relative grid grid-cols-[56px_minmax(0,1fr)_110px_130px_130px_44px] items-center gap-[18px] border-b px-4 py-3 text-sm last:border-b-0">
      <FormPreviewArt
        preview={form.preview}
        compact
        className="border-ink h-10 w-14 rounded-sm border-[1.5px]"
      />
      <Link
        href={`/forms/${form.id}`}
        className="font-heading focus-visible:after:shadow-focus truncate text-base font-bold outline-none after:absolute after:inset-0 after:content-['']"
      >
        {form.title}
      </Link>
      <StatusChip tone={status.tone} size="sm">
        {status.label}
      </StatusChip>
      <span>{form.responseCount.toLocaleString()}</span>
      <span className="text-muted-foreground">
        <LocalTime iso={form.updatedAt} variant="relative" />
      </span>
      <FormActionsMenu form={form} />
    </div>
  );
}

function PhoneCard({ form }: { form: FormListItem }) {
  const status = STATUS[form.publishState];
  return (
    <div className="border-ink bg-card shadow-raised relative flex items-center gap-3 rounded-lg border-[1.5px] p-2.5">
      <FormPreviewArt
        preview={form.preview}
        compact
        className="border-ink h-14 w-16 shrink-0 rounded-sm border-[1.5px]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/forms/${form.id}`}
          className="font-heading truncate text-[15px] font-bold outline-none after:absolute after:inset-0 after:content-['']"
        >
          {form.title}
        </Link>
        <span className="text-muted-foreground flex items-center gap-1.5 truncate text-[12.5px]">
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-full"
            style={{
              background: `var(--chip-${status.tone === "pending" ? "pending" : status.tone}-dot)`,
            }}
          />
          {status.label} · {form.responseCount.toLocaleString()} ·{" "}
          <LocalTime iso={form.updatedAt} variant="relative" />
        </span>
      </span>
      <FormActionsMenu form={form} vertical />
    </div>
  );
}

/**
 * The forms dashboard (Part 3 §5.1): search, All / Live / Draft filter,
 * sort, and a grid of themed form cards or a compact list.
 */
export function FormsBrowser({
  forms,
  workspaceName,
  canEdit = true,
  folders = [],
  currentUserId,
}: {
  forms: FormListItem[];
  workspaceName: string;
  folders?: { id: string; name: string }[];
  /** For "Created by me". */
  currentUserId?: string;
  /** Viewers see the forms without the editing actions. */
  canEdit?: boolean;
}) {
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("edited");
  const [storedView, storeView] = useStoredValue(VIEW_KEY, "grid");
  const view: View = storedView === "list" ? "list" : "grid";
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderFilter>("all");
  const [mine, setMine] = useState(false);

  // ⌘K / Ctrl+K focuses search; the phone top bar links here with ?focus=search.
  useEffect(() => {
    if (params.get("focus") === "search") searchRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [params]);

  function changeView(next: View) {
    storeView(next);
  }

  const q = query.trim().toLowerCase();
  // Folder and "created by me" narrow first; search and status within that.
  const inScope = useMemo(
    () =>
      forms.filter(
        (f) =>
          (!mine || f.createdBy === currentUserId) &&
          (folder === "all"
            ? true
            : folder === "none"
              ? !f.folderId
              : f.folderId === folder),
      ),
    [forms, folder, mine, currentUserId],
  );
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = { all: forms.length, none: 0 };
    for (const f of forms) {
      const key = f.folderId ?? "none";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [forms]);
  const searched = useMemo(
    () => (q ? inScope.filter((f) => f.title.toLowerCase().includes(q)) : inScope),
    [inScope, q],
  );
  const counts = {
    all: searched.length,
    live: searched.filter((f) => f.publishState === "live").length,
    draft: searched.filter((f) => f.publishState !== "live").length,
  };
  const visible = useMemo(() => {
    const filtered = searched.filter((f) =>
      filter === "all"
        ? true
        : filter === "live"
          ? f.publishState === "live"
          : f.publishState !== "live",
    );
    const by: Record<Sort, (a: FormListItem, b: FormListItem) => number> = {
      edited: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => a.title.localeCompare(b.title),
      responses: (a, b) => b.responseCount - a.responseCount,
    };
    return [...filtered].sort(by[sort]);
  }, [searched, filter, sort]);

  const duplicatingForm = duplicating
    ? forms.find((f) => f.id === duplicating)
    : undefined;

  return (
    <CanEditContext.Provider value={canEdit}>
      <FoldersContext.Provider value={folders}>
        <div className="mb-[22px] flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div>
            <div className="text-muted-foreground text-[13px] sm:text-[15px]">
              <span className="sm:hidden">
                {forms.length} form{forms.length === 1 ? "" : "s"}
              </span>
              <span className="hidden sm:inline">
                {forms.length} form{forms.length === 1 ? "" : "s"} in {workspaceName}
              </span>
            </div>
            <h1 className="font-heading mt-1 text-[38px] leading-none font-bold tracking-[-0.03em] sm:mt-2 sm:text-[56px] sm:tracking-[-0.035em]">
              Forms
            </h1>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <label className="group border-border bg-card text-muted-foreground focus-within:border-ink focus-within:bg-field focus-within:text-foreground flex h-11 w-[260px] items-center gap-2 rounded-sm border-[1.5px] px-3 text-sm focus-within:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]">
              <Search className="size-4 shrink-0" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Search forms"
                aria-label="Search forms"
                className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground rounded-xs"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <kbd className="border-border rounded-[5px] border px-1.5 py-[3px] font-sans text-[11px] leading-none font-semibold">
                  ⌘K
                </kbd>
              )}
            </label>
            <Button asChild variant="outline" className="h-11 px-[18px] font-semibold">
              <Link href="/templates">Browse templates</Link>
            </Button>
          </div>
        </div>

        <FolderBar
          folders={folders}
          counts={folderCounts}
          value={folder}
          onChange={setFolder}
          canEdit={canEdit}
        />
        <div className="mb-[22px] flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Filter forms"
            className="border-border bg-card flex gap-0.5 rounded-full border-[1.5px] p-[3px] text-[13.5px] font-semibold"
          >
            {(["all", "live", "draft"] as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "fc-focus rounded-full px-3.5 py-2 sm:py-1.5",
                  filter === key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "all" ? "All" : key === "live" ? "Live" : "Draft"} {counts[key]}
              </button>
            ))}
          </div>
          {currentUserId && (
            <label className="text-muted-foreground flex items-center gap-1.5 text-[13.5px] font-semibold">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
                className="size-3.5 accent-[var(--ink)]"
              />
              Created by me
            </label>
          )}
          {q && (
            <span className="text-muted-foreground text-[13.5px]">
              {visible.length} result{visible.length === 1 ? "" : "s"} for “{query.trim()}
              ”
            </span>
          )}
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="fc-focus text-muted-foreground aria-expanded:border-ink aria-expanded:bg-card hidden h-8 items-center gap-1.5 rounded-sm border-[1.5px] border-transparent px-2.5 text-[13.5px] sm:flex"
              >
                Sort by{" "}
                <b className="text-foreground">{SORTS.find(([k]) => k === sort)?.[1]}</b>
                <ChevronDown className="size-3.5 in-aria-expanded:rotate-180" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              {SORTS.map(([key, label]) => (
                <DropdownMenuItem
                  key={key}
                  onSelect={() => setSort(key)}
                  className={cn("justify-between", sort === key && "bg-accent")}
                >
                  {label}
                  {sort === key && <Check className="size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="border-border hidden overflow-hidden rounded-sm border-[1.5px] sm:flex">
            {(
              [
                ["grid", LayoutGrid, "Grid view"],
                ["list", List, "List view"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={view === key}
                onClick={() => changeView(key)}
                className={cn(
                  "fc-focus grid h-8 w-9 place-items-center",
                  view === key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="border-input text-muted-foreground flex flex-col items-start gap-1.5 rounded-lg border-[1.5px] border-dashed p-4 text-sm">
            {q ? (
              <>
                <span>No forms match ‘{query.trim()}’.</span>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-foreground decoration-primary font-bold underline decoration-2 underline-offset-4"
                >
                  Clear search
                </button>
              </>
            ) : (
              <span>No {filter === "live" ? "live" : "draft"} forms yet.</span>
            )}
          </div>
        ) : (
          <>
            {/* Phones: compact cards. */}
            <div className="flex flex-col gap-3.5 sm:hidden">
              {visible.map((form) => (
                <PhoneCard key={form.id} form={form} />
              ))}
            </div>
            <div className="hidden sm:block">
              {view === "grid" ? (
                <div className="wide:grid-cols-4 grid grid-cols-2 gap-[22px] lg:grid-cols-3">
                  {visible.map((form) => (
                    <FormCard
                      key={form.id}
                      form={form}
                      onDuplicating={(pending) =>
                        setDuplicating(pending ? form.id : null)
                      }
                    />
                  ))}
                  {duplicatingForm && <DuplicatingCard title={duplicatingForm.title} />}
                </div>
              ) : (
                <div className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px]">
                  <div className="border-ink bg-background text-muted-foreground grid grid-cols-[56px_minmax(0,1fr)_110px_130px_130px_44px] gap-[18px] border-b-[1.5px] px-4 py-2.5 text-[11.5px] font-bold tracking-[0.08em] uppercase">
                    <span />
                    <span>Form</span>
                    <span>Status</span>
                    <span>Responses</span>
                    <span>Edited</span>
                    <span />
                  </div>
                  {visible.map((form) => (
                    <FormListRow key={form.id} form={form} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Phones: the New form button floats bottom right. */}
        {canEdit && (
          <form
            action={createFormAction}
            className="fixed right-4 bottom-6 z-20 sm:hidden"
          >
            <SubmitButton
              className="shadow-card h-[52px] rounded-full px-5 text-[15px]"
              icon={<Plus className="size-[18px]" />}
              pendingLabel="Creating…"
            >
              New form
            </SubmitButton>
          </form>
        )}
      </FoldersContext.Provider>
    </CanEditContext.Provider>
  );
}
