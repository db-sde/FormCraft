// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEmbedSnippet,
  EMBED_MAX_HEIGHT,
  EMBED_MIN_HEIGHT,
} from "@/domains/forms/embed";

/** Installs the generated <script> in the jsdom page, with one embedded
 * form frame, and returns what's needed to send it messages. */
function install(formId = "form_1") {
  const snippet = buildEmbedSnippet({
    formUrl: "https://app.example.com/f/demo",
    formId,
    title: "Demo",
  });
  const script = snippet.match(/<script>([\s\S]*)<\/script>/)![1];
  const frame = document.createElement("iframe");
  frame.setAttribute("data-formcraft", formId);
  frame.style.height = "600px";
  document.body.append(frame);
  const other = document.createElement("iframe");
  other.setAttribute("data-formcraft", formId);
  other.style.height = "600px";
  document.body.append(other);
  new Function(script)();

  const send = (data: unknown, source: Window | null = frame.contentWindow) =>
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  return { frame, other, send, snippet };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("embed snippet", () => {
  it("resizes the frame that sent the message", () => {
    const { frame, send } = install();
    send({ type: "formcraft:height", formId: "form_1", height: 840 });
    expect(frame.style.height).toBe("840px");
  });

  it("ignores a message from anything other than that frame", () => {
    const { frame, other, send } = install();
    send(
      { type: "formcraft:height", formId: "form_1", height: 840 },
      other.contentWindow,
    );
    expect(frame.style.height).toBe("600px");
    send({ type: "formcraft:height", formId: "form_1", height: 840 }, window);
    expect(frame.style.height).toBe("600px");
  });

  it("works whatever origin the form is served from", () => {
    // No origin comparison: a form on www. or a custom domain still resizes.
    const { frame, send } = install();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "formcraft:height", formId: "form_1", height: 700 },
        origin: "https://www.other-host.example",
        source: frame.contentWindow,
      }),
    );
    expect(frame.style.height).toBe("700px");
  });

  it("ignores messages about another form or of another kind", () => {
    const { frame, send } = install();
    send({ type: "formcraft:height", formId: "someone_else", height: 840 });
    send({ type: "something-else", formId: "form_1", height: 840 });
    send("formcraft:height");
    send(null);
    expect(frame.style.height).toBe("600px");
  });

  it("clamps absurd heights and ignores non-numbers", () => {
    const { frame, send } = install();
    send({ type: "formcraft:height", formId: "form_1", height: 9e9 });
    expect(frame.style.height).toBe(`${EMBED_MAX_HEIGHT}px`);
    send({ type: "formcraft:height", formId: "form_1", height: 0 });
    expect(frame.style.height).toBe(`${EMBED_MIN_HEIGHT}px`);
    send({ type: "formcraft:height", formId: "form_1", height: -50 });
    expect(frame.style.height).toBe(`${EMBED_MIN_HEIGHT}px`);
    send({ type: "formcraft:height", formId: "form_1", height: 500 });
    send({ type: "formcraft:height", formId: "form_1", height: "tall" });
    send({ type: "formcraft:height", formId: "form_1", height: Infinity });
    send({ type: "formcraft:height", formId: "form_1", height: NaN });
    expect(frame.style.height).toBe("500px");
  });

  it("escapes the title so it can't break out of the attribute", () => {
    const { snippet } = install();
    const hostile = buildEmbedSnippet({
      formUrl: "https://app.example.com/f/demo",
      formId: "form_1",
      title: 'x" onload="alert(1)"><script>',
    });
    expect(hostile).not.toContain('onload="alert');
    expect(hostile.match(/<script>/g)).toHaveLength(1);
    expect(snippet).toContain('title="Demo"');
  });
});
