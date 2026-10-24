import { describe, expect, it } from "vitest";
import { precheckUpload, uploadRefusalMessage } from "@/domains/uploads/precheck";

// QA FC-10: oversize and wrong-type files are refused at once, specifically.
const limits = { acceptedMimeTypes: ["image/*", "application/pdf"], maxSizeMb: 5 };
const MB = 1024 * 1024;

describe("checking a file before it's uploaded", () => {
  it("accepts a file within the limits", () => {
    expect(precheckUpload({ size: 300, type: "image/png" }, limits)).toBeNull();
    expect(precheckUpload({ size: 5 * MB, type: "application/pdf" }, limits)).toBeNull();
  });

  it("refuses a file over the size limit, saying the limit", () => {
    expect(precheckUpload({ size: 6 * MB, type: "image/png" }, limits)).toBe(
      "That file is larger than 5 MB. Choose a smaller one.",
    );
  });

  it("refuses the wrong kind of file, saying what's allowed", () => {
    expect(precheckUpload({ size: 11, type: "text/plain" }, limits)).toBe(
      "That kind of file can't be uploaded here. Allowed: Images, PDF files.",
    );
  });

  it("leaves a file of unknown type to the server", () => {
    expect(precheckUpload({ size: 11, type: "" }, limits)).toBeNull();
  });

  it("gives the server's refusals the same wording", () => {
    expect(uploadRefusalMessage("too_large", limits)).toMatch(/larger than 5 MB/);
    expect(uploadRefusalMessage("unsupported_type", limits)).toMatch(/Allowed: Images/);
    expect(uploadRefusalMessage("unknown", limits)).toBe("The upload failed. Try again.");
  });
});
