import { describe, expect, it } from "vitest";
import { sniffContentType, matchesAcceptedTypes } from "@/domains/uploads/sniff";

function bytesOf(...values: number[]): Uint8Array {
  const arr = new Uint8Array(16);
  values.forEach((v, i) => (arr[i] = v));
  return arr;
}

describe("sniffContentType", () => {
  it("detects a PNG by magic bytes", () => {
    const png = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(sniffContentType(png)?.mimeType).toBe("image/png");
  });

  it("detects a JPEG by magic bytes", () => {
    const jpeg = bytesOf(0xff, 0xd8, 0xff, 0xe0);
    expect(sniffContentType(jpeg)?.mimeType).toBe("image/jpeg");
  });

  it("detects a PDF by magic bytes", () => {
    const pdf = bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
    expect(sniffContentType(pdf)?.mimeType).toBe("application/pdf");
  });

  it("rejects a file whose declared type doesn't match its actual bytes", () => {
    // A plain text file pretending (via filename/declared type) to be
    // an image — the byte signature check must catch this regardless
    // of what the browser claims.
    const textDisguisedAsImage = new TextEncoder().encode(
      "just some plain text, not an image",
    );
    expect(sniffContentType(textDisguisedAsImage)).toBeNull();
  });

  it("returns null for too-short input", () => {
    expect(sniffContentType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe("matchesAcceptedTypes", () => {
  it("matches an exact type", () => {
    expect(matchesAcceptedTypes("application/pdf", ["application/pdf"])).toBe(true);
    expect(matchesAcceptedTypes("application/pdf", ["image/png"])).toBe(false);
  });

  it("matches a wildcard group", () => {
    expect(matchesAcceptedTypes("image/png", ["image/*"])).toBe(true);
    expect(matchesAcceptedTypes("image/jpeg", ["image/*"])).toBe(true);
    expect(matchesAcceptedTypes("application/pdf", ["image/*"])).toBe(false);
  });
});
