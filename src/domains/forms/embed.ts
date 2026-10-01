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
