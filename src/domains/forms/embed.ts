const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Smallest / largest height (px) the embed will resize to. */
export const EMBED_MIN_HEIGHT = 200;
export const EMBED_MAX_HEIGHT = 20_000;

/**
 * The HTML a creator pastes into their own site to embed a form. The
 * form reports its height with postMessage and the script resizes the
 * iframe to match.
 *
 * The script trusts a message only if it came from the very iframe it
 * is resizing (`event.source`) and names this form. It deliberately
 * does NOT compare `event.origin` to a configured address: that breaks
 * the moment the form is served from another host than the one in the
 * setting (www vs bare domain, a custom domain), and the frame check is
 * the stronger test anyway. The height is only used if it's a finite
 * number, and is clamped so a bad value can't blank or stretch the page.
 */
export function buildEmbedSnippet(options: {
  formUrl: string;
  formId: string;
  title: string;
}): string {
  const id = JSON.stringify(options.formId);
  const selector = JSON.stringify(`iframe[data-formcraft="${options.formId}"]`);
  const script =
    `window.addEventListener("message",function(e){var d=e.data;` +
    `if(!d||d.type!=="formcraft:height"||d.formId!==${id}` +
    `||typeof d.height!=="number"||!isFinite(d.height))return;` +
    `var h=Math.min(Math.max(d.height,${EMBED_MIN_HEIGHT}),${EMBED_MAX_HEIGHT});` +
    `document.querySelectorAll(${selector}).forEach(function(f){` +
    `if(f.contentWindow===e.source)f.style.height=h+"px"})});`;
  return [
    `<iframe src="${escapeAttribute(options.formUrl)}?embed=1" data-formcraft="${escapeAttribute(options.formId)}" width="100%" height="600" style="border:0;border-radius:12px;width:100%" title="${escapeAttribute(options.title)}"></iframe>`,
    `<script>${script}</script>`,
  ].join("\n");
}

export type PopupMode = "popup" | "side-tab" | "button";

/**
 * Popup, side-tab and button embeds (PRD P2.23): a launcher on the
 * creator's page that opens the form in an overlay. Everything lives in
 * a shadow root with inline styles, so the host page's CSS can't restyle
 * it and it can't leak styles out; the only global is nothing at all
 * (an IIFE). Escape and the close button close it, focus returns to the
 * launcher, and the page behind doesn't scroll while it's open.
 * `label` and `color` are escaped / validated before going into code.
 */
export function buildPopupSnippet(options: {
  formUrl: string;
  formId: string;
  title: string;
  mode: PopupMode;
  label: string;
  color: string;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(options.color) ? options.color : "#1f1f1f";
  const config = JSON.stringify({
    url: `${options.formUrl}?embed=1`,
    title: options.title.slice(0, 200),
    label: options.label.slice(0, 40) || "Open form",
    mode: options.mode,
    color,
  })
    // Safe inside a <script> element whatever the strings contain.
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const script =
    `(function(c){var host=document.createElement("div");host.setAttribute("data-formcraft-popup",${JSON.stringify(options.formId)});` +
    `var root=host.attachShadow({mode:"open"});` +
    `var tab=c.mode==="side-tab";` +
    `var btnCss=tab?"position:fixed;right:0;top:50%;transform:translateY(-50%) rotate(-90deg);transform-origin:bottom right;border-radius:8px 8px 0 0;padding:10px 16px;z-index:2147483000;":` +
    `(c.mode==="popup"?"position:fixed;right:20px;bottom:20px;border-radius:999px;padding:14px 22px;z-index:2147483000;box-shadow:0 6px 20px rgba(0,0,0,.2);":"border-radius:8px;padding:12px 20px;");` +
    `var btn=document.createElement("button");btn.type="button";btn.textContent=c.label;` +
    `btn.setAttribute("style",btnCss+"background:"+c.color+";color:#fff;border:0;font:600 15px system-ui,sans-serif;cursor:pointer;");` +
    `root.appendChild(btn);` +
    `var overlay,last,overflow;` +
    `function close(){if(!overlay)return;overlay.remove();overlay=null;document.documentElement.style.overflow=overflow;document.removeEventListener("keydown",onKey);if(last)last.focus();}` +
    `function onKey(e){if(e.key==="Escape")close();}` +
    `function open(){if(overlay)return;last=root.activeElement||document.activeElement;overflow=document.documentElement.style.overflow;document.documentElement.style.overflow="hidden";` +
    `overlay=document.createElement("div");overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label",c.title);` +
    `overlay.setAttribute("style","position:fixed;inset:0;z-index:2147483001;background:rgba(20,16,12,.55);display:flex;align-items:center;justify-content:center;padding:16px;");` +
    `overlay.addEventListener("click",function(e){if(e.target===overlay)close();});` +
    `var box=document.createElement("div");box.setAttribute("style","position:relative;width:100%;max-width:720px;height:min(90vh,760px);background:#fff;border-radius:14px;overflow:hidden;");` +
    `var x=document.createElement("button");x.type="button";x.setAttribute("aria-label","Close");x.textContent="\\u00d7";` +
    `x.setAttribute("style","position:absolute;top:8px;right:10px;z-index:1;width:36px;height:36px;border:0;border-radius:999px;background:rgba(0,0,0,.06);font:24px/1 system-ui,sans-serif;cursor:pointer;");` +
    `x.addEventListener("click",close);` +
    `var f=document.createElement("iframe");f.src=c.url;f.title=c.title;f.setAttribute("style","width:100%;height:100%;border:0;");` +
    `box.appendChild(x);box.appendChild(f);overlay.appendChild(box);root.appendChild(overlay);document.addEventListener("keydown",onKey);x.focus();}` +
    `btn.addEventListener("click",open);` +
    `var s=document.currentScript;if(c.mode==="button"&&s&&s.parentNode){s.parentNode.insertBefore(host,s);}else{document.body.appendChild(host);}` +
    `})(${config});`;
  return `<script>${script}</script>`;
}
