/**
 * The embed SDK (master spec F-24): one script, served from this app,
 * that turns `<div data-formcraft="slug">` elements on another site into
 * an inline form, a popup, a slide-in, a side tab, a full-page overlay
 * or a button — opened by a click, after a delay, or on scroll — and
 * exposes `FormCraft.open(slug)` / `FormCraft.close()`.
 *
 * Safety: the script only ever frames this app's own `/f/<slug>` pages
 * (the slug is checked against the slug pattern, the origin is the
 * script's own), puts its launcher in a shadow root with inline styles
 * so the host page can't restyle it, and adds no globals besides
 * `FormCraft`. The form page itself keeps its own CSP. Overlays are
 * dialogs: Escape and the close button close them, focus moves in and
 * returns to where it was, and the page behind doesn't scroll.
 *
 * Analytics: one impression per embed per page load and one open per
 * overlay per page load, sent as beacons with a random page-view id the
 * server dedupes on. Automatic opens (delay, scroll) happen at most once
 * per browser session per form, so visitors aren't nagged.
 */

export const EMBED_MODES = [
  "inline",
  "popup",
  "slide-in",
  "side-tab",
  "full-page",
  "button",
] as const;
export type EmbedSdkMode = (typeof EMBED_MODES)[number];

export const EMBED_MODE_LABEL: Record<EmbedSdkMode, string> = {
  inline: "Inline",
  popup: "Popup",
  "slide-in": "Slide-in",
  "side-tab": "Side tab",
  "full-page": "Full page",
  button: "Button",
};

/** Modes that open on their own (a delay or scrolling), not only on a click. */
export const AUTO_OPEN_MODES: readonly EmbedSdkMode[] = [
  "popup",
  "slide-in",
  "full-page",
];

export type EmbedTrigger =
  | { kind: "click" }
  | { kind: "delay"; seconds: number }
  | { kind: "scroll"; percent: number };

export function triggerAttribute(trigger: EmbedTrigger): string {
  if (trigger.kind === "delay") return `delay:${trigger.seconds}`;
  if (trigger.kind === "scroll") return `scroll:${trigger.percent}`;
  return "click";
}

/** Reads `data-trigger`; anything malformed is a click. */
export function parseTrigger(raw: string | null | undefined): EmbedTrigger {
  const m = /^(delay|scroll):(\d{1,3})$/.exec(raw ?? "");
  if (!m) return { kind: "click" };
  const n = Number(m[2]);
  if (m[1] === "delay") return { kind: "delay", seconds: Math.min(Math.max(n, 0), 120) };
  return { kind: "scroll", percent: Math.min(Math.max(n, 1), 100) };
}

const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** The HTML a creator pastes for an SDK embed. */
export function buildSdkSnippet(options: {
  origin: string;
  slug: string;
  mode: EmbedSdkMode;
  trigger?: EmbedTrigger;
  label?: string;
  color?: string;
}): string {
  const attrs = [
    `data-formcraft="${escapeAttribute(options.slug)}"`,
    `data-mode="${options.mode}"`,
  ];
  if (AUTO_OPEN_MODES.includes(options.mode) && options.trigger) {
    attrs.push(`data-trigger="${triggerAttribute(options.trigger)}"`);
  }
  if (options.mode !== "inline" && options.label) {
    attrs.push(`data-label="${escapeAttribute(options.label.slice(0, 40))}"`);
  }
  if (options.color && /^#[0-9a-fA-F]{6}$/.test(options.color)) {
    attrs.push(`data-color="${options.color}"`);
  }
  return [
    `<div ${attrs.join(" ")}></div>`,
    `<script src="${escapeAttribute(options.origin)}/api/embed/sdk.js" async></script>`,
  ].join("\n");
}

/** The SDK itself, as served at /api/embed/sdk.js. Plain ES5 so it runs
 * on any site. */
export const EMBED_SDK_SOURCE = String.raw`(function () {
  if (window.FormCraft && window.FormCraft.__v) return;
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : "";
  var SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
  var COLOR = /^#[0-9a-fA-F]{6}$/;
  var pageview = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var sent = {};
  var open = null;

  function beacon(slug, event, mode, trigger) {
    var key = slug + ":" + event + ":" + mode;
    if (sent[key]) return;
    sent[key] = true;
    var body = JSON.stringify({ slug: slug, event: event, mode: mode, trigger: trigger, pageview: pageview });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(origin + "/api/embed/events", body);
      else fetch(origin + "/api/embed/events", { method: "POST", body: body, keepalive: true, mode: "no-cors" });
    } catch (e) {}
  }

  function frame(slug, title) {
    var f = document.createElement("iframe");
    f.src = origin + "/f/" + slug + "?embed=1";
    f.title = title || "Form";
    f.setAttribute("allow", "clipboard-write");
    f.setAttribute("data-formcraft-frame", slug);
    return f;
  }

  // Inline embeds grow with the form (it reports its height).
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (d && d.type === "formcraft:escape" && open && open.frame.contentWindow === e.source) {
      close();
      return;
    }
    if (!d || d.type !== "formcraft:height" || typeof d.height !== "number" || !isFinite(d.height)) return;
    var frames = document.querySelectorAll("iframe[data-formcraft-inline]");
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = Math.min(Math.max(d.height, 200), 20000) + "px";
      }
    }
  });

  function close() {
    if (!open) return;
    open.host.remove();
    document.documentElement.style.overflow = open.overflow;
    document.removeEventListener("keydown", onKey, true);
    if (open.last && open.last.focus) open.last.focus();
    open = null;
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "Tab" && open) {
      // Keep focus inside the dialog: the close button and the form.
      var items = [open.closeButton, open.frame];
      var active = open.root.activeElement || document.activeElement;
      var i = items.indexOf(active);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  }

  function openForm(slug, options) {
    options = options || {};
    if (!SLUG.test(slug || "")) return;
    var mode = options.mode === "slide-in" || options.mode === "full-page" ? options.mode : "popup";
    if (open) close();
    var host = document.createElement("div");
    host.setAttribute("data-formcraft-overlay", slug);
    var root = host.attachShadow({ mode: "open" });
    var overflow = document.documentElement.style.overflow;
    var full = mode === "full-page";
    var slide = mode === "slide-in";
    var shade = document.createElement("div");
    shade.setAttribute("style", slide
      ? "position:fixed;right:16px;bottom:16px;z-index:2147483001;width:min(400px,calc(100vw - 32px));height:min(620px,calc(100vh - 32px));"
      : "position:fixed;inset:0;z-index:2147483001;background:" + (full ? "#fff" : "rgba(20,16,12,.55)") + ";display:flex;align-items:center;justify-content:center;padding:" + (full ? "0" : "16px") + ";");
    if (!slide) document.documentElement.style.overflow = "hidden";
    var box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", slide ? "false" : "true");
    box.setAttribute("aria-label", options.title || "Form");
    box.setAttribute("style", "position:relative;background:#fff;overflow:hidden;" + (full ? "width:100%;height:100%;" : slide ? "width:100%;height:100%;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);" : "width:100%;max-width:720px;height:min(90vh,760px);border-radius:14px;"));
    var x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.setAttribute("style", "position:absolute;top:8px;right:10px;z-index:1;width:36px;height:36px;border:0;border-radius:999px;background:rgba(0,0,0,.06);font:24px/1 system-ui,sans-serif;cursor:pointer;");
    x.addEventListener("click", close);
    var f = frame(slug, options.title);
    f.setAttribute("style", "width:100%;height:100%;border:0;");
    box.appendChild(x);
    box.appendChild(f);
    shade.appendChild(box);
    if (!slide && !full) shade.addEventListener("click", function (e) { if (e.target === shade) close(); });
    root.appendChild(shade);
    document.body.appendChild(host);
    open = { host: host, root: root, overflow: overflow, last: document.activeElement, closeButton: x, frame: f };
    document.addEventListener("keydown", onKey, true);
    x.focus();
    beacon(slug, "open", mode, options.trigger || "api");
  }

  function launcher(el, slug, mode, label, color, opensAs) {
    var host = document.createElement("div");
    var root = host.attachShadow({ mode: "open" });
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    var tab = mode === "side-tab";
    var floating = mode === "popup" || mode === "slide-in";
    b.setAttribute("style",
      (tab ? "position:fixed;right:0;top:50%;transform:translateY(-50%) rotate(-90deg);transform-origin:bottom right;border-radius:8px 8px 0 0;padding:10px 16px;z-index:2147483000;"
        : floating ? "position:fixed;right:20px;bottom:20px;border-radius:999px;padding:14px 22px;z-index:2147483000;box-shadow:0 6px 20px rgba(0,0,0,.2);"
        : "border-radius:8px;padding:12px 20px;") +
      "background:" + color + ";color:#fff;border:0;font:600 15px system-ui,sans-serif;cursor:pointer;");
    b.addEventListener("click", function () {
      openForm(slug, { mode: opensAs, title: label, trigger: "click" });
    });
    root.appendChild(b);
    if (tab || floating) document.body.appendChild(host);
    else el.appendChild(host);
  }

  function autoOpen(slug, mode, trigger, title) {
    var key = "formcraft:auto:" + slug;
    try { if (sessionStorage.getItem(key)) return; } catch (e) {}
    function go(kind) {
      try { sessionStorage.setItem(key, "1"); } catch (e) {}
      openForm(slug, { mode: mode, title: title, trigger: kind });
    }
    var m = /^(delay|scroll):(\d{1,3})$/.exec(trigger || "");
    if (!m) return;
    var n = Number(m[2]);
    if (m[1] === "delay") { setTimeout(function () { go("delay"); }, Math.min(n, 120) * 1000); return; }
    var target = Math.min(Math.max(n, 1), 100) / 100;
    function onScroll() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0 || window.scrollY / max >= target) {
        window.removeEventListener("scroll", onScroll);
        go("scroll");
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function mount(el) {
    if (el.getAttribute("data-formcraft-mounted")) return;
    var slug = el.getAttribute("data-formcraft") || "";
    if (!SLUG.test(slug)) return;
    el.setAttribute("data-formcraft-mounted", "1");
    var mode = el.getAttribute("data-mode") || "inline";
    var label = (el.getAttribute("data-label") || "Open form").slice(0, 40);
    var color = el.getAttribute("data-color");
    if (!COLOR.test(color || "")) color = "#1f1f1f";
    var trigger = el.getAttribute("data-trigger") || "click";
    if (mode === "inline") {
      var f = frame(slug, label);
      f.setAttribute("data-formcraft-inline", "1");
      f.setAttribute("style", "width:100%;height:600px;border:0;border-radius:12px;");
      el.appendChild(f);
    } else if (mode === "full-page" && trigger === "click") {
      launcher(el, slug, "button", label, color, "full-page");
    } else if (mode === "popup" || mode === "slide-in" || mode === "side-tab" || mode === "button" || mode === "full-page") {
      if (mode !== "full-page") launcher(el, slug, mode, label, color, mode === "side-tab" ? "slide-in" : mode === "button" ? "popup" : mode);
      if (mode === "popup" || mode === "slide-in" || mode === "full-page") autoOpen(slug, mode, trigger, label);
    } else return;
    beacon(slug, "impression", mode, trigger);
  }

  function scan() {
    var els = document.querySelectorAll("[data-formcraft]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  window.FormCraft = { __v: 1, open: openForm, close: close, scan: scan };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
`;
