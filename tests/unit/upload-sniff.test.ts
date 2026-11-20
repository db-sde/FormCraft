import { describe, expect, it } from "vitest";
import {
  sniffContentType,
  matchesAcceptedTypes,
  mediaMimeType,
} from "@/domains/uploads/sniff";
import { mediaMaxBytes } from "@/domains/uploads/queries";

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

describe("recordings (roadmap #21)", () => {
  const bytes = (head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)]);
  const webm = bytes([0x1a, 0x45, 0xdf, 0xa3]);
  const ogg = bytes([0x4f, 0x67, 0x67, 0x53]);
  const mp4 = bytes([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);

  it("knows the containers browsers record into", () => {
    expect(sniffContentType(webm)?.extension).toBe("webm");
    expect(sniffContentType(ogg)?.mimeType).toBe("audio/ogg");
    expect(sniffContentType(mp4)?.extension).toBe("mp4");
  });

  it("stores them as the kind the question asks for, and nothing else", () => {
    expect(mediaMimeType(sniffContentType(webm), "audio")?.mimeType).toBe("audio/webm");
    expect(mediaMimeType(sniffContentType(webm), "video")?.mimeType).toBe("video/webm");
    expect(mediaMimeType(sniffContentType(mp4), "audio")).toEqual({
      mimeType: "audio/mp4",
      extension: "m4a",
    });
    expect(mediaMimeType(sniffContentType(ogg), "video")).toBeNull();
    const png = bytes([0x89, 0x50, 0x4e, 0x47]);
    expect(mediaMimeType(sniffContentType(png), "video")).toBeNull();
  });

  it("caps the size from the time limit, never above the hard ceiling", () => {
    expect(mediaMaxBytes("audio", 60)).toBe(60 * 32 * 1024 + 512 * 1024);
    expect(mediaMaxBytes("video", 60)).toBe(60 * 512 * 1024 + 512 * 1024);
    expect(mediaMaxBytes("video", 300)).toBe(100 * 1024 * 1024);
  });
});
