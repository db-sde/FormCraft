import { describe, expect, it } from "vitest";
import {
  contactFromAnswers,
  isSchedulerUrl,
  schedulerEmbedUrl,
} from "@/domains/forms/scheduler";

describe("booking pages on endings (P2.16)", () => {
  it("only embed Calendly and Cal.com's own hosts, over https", () => {
    expect(isSchedulerUrl("calendly", "https://calendly.com/ada/intro")).toBe(true);
    expect(isSchedulerUrl("cal", "https://cal.com/ada/30min")).toBe(true);
    expect(isSchedulerUrl("calendly", "https://calendly.com.evil.example/x")).toBe(false);
    expect(isSchedulerUrl("calendly", "http://calendly.com/ada")).toBe(false);
    expect(isSchedulerUrl("cal", "https://calendly.com/ada")).toBe(false);
  });

  it("prefill name and email and tag the response", () => {
    const calendly = new URL(
      schedulerEmbedUrl(
        { provider: "calendly", url: "https://calendly.com/ada/intro" },
        { name: "Grace", email: "g@example.com", responseId: "r1" },
      )!,
    );
    expect(calendly.searchParams.get("name")).toBe("Grace");
    expect(calendly.searchParams.get("email")).toBe("g@example.com");
    expect(calendly.searchParams.get("utm_content")).toBe("r1");

    const cal = new URL(
      schedulerEmbedUrl(
        { provider: "cal", url: "https://cal.com/ada/30" },
        { responseId: "r2" },
      )!,
    );
    expect(cal.searchParams.get("metadata[formcraftResponseId]")).toBe("r2");
    expect(
      schedulerEmbedUrl({ provider: "cal", url: "https://evil.example/x" }, {}),
    ).toBeNull();
  });

  it("find the respondent's name and email in the answers", () => {
    const schema = {
      questions: [
        { id: "c", type: "contact_info" },
        { id: "e", type: "email" },
      ],
    } as never;
    expect(
      contactFromAnswers(schema, { c: { name: "Ada" }, e: "ada@example.com" }),
    ).toEqual({
      name: "Ada",
      email: "ada@example.com",
    });
  });
});
