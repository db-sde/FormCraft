import { describe, expect, it } from "vitest";
import { leadCaptureStatus } from "@/domains/leads/status";

const base = {
  draftHasContactStep: true,
  publishedHasContactStep: true,
  isLive: true,
  savesUnfinished: true,
};

describe("leadCaptureStatus", () => {
  it("is on only when the live form has the step and keeps unfinished responses", () => {
    expect(leadCaptureStatus(base).state).toBe("on");
  });

  it("does not claim capture is on for a step that exists only in the draft", () => {
    expect(leadCaptureStatus({ ...base, publishedHasContactStep: false }).state).toBe(
      "needs_publish",
    );
    expect(leadCaptureStatus({ ...base, isLive: false }).state).toBe("needs_publish");
  });

  it("warns when the form doesn't save unfinished responses", () => {
    const status = leadCaptureStatus({ ...base, savesUnfinished: false });
    expect(status.state).toBe("paused");
    expect(status.description).toMatch(/only get contact details from people who submit/);
  });

  it("is off with no contact step anywhere", () => {
    expect(
      leadCaptureStatus({
        ...base,
        draftHasContactStep: false,
        publishedHasContactStep: false,
      }).state,
    ).toBe("off");
  });

  it("keeps saying it's on while the live form still has a step the draft dropped", () => {
    const status = leadCaptureStatus({ ...base, draftHasContactStep: false });
    expect(status.state).toBe("on");
    expect(status.description).toMatch(/publish to turn lead capture off/);
  });
});
