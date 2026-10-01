export type LeadCaptureState = "off" | "needs_publish" | "paused" | "on";

export type LeadCaptureStatus = {
  state: LeadCaptureState;
  title: string;
  description: string;
};

/**
 * Whether lead capture is actually working for respondents — not just
 * whether the builder contains a contact step. Respondents see the
 * PUBLISHED version, and contact details are only kept from people who
 * don't finish if the form saves unfinished responses, so "the draft
 * has a contact step" alone would often say "on" when it isn't.
 */
export function leadCaptureStatus(input: {
  draftHasContactStep: boolean;
  publishedHasContactStep: boolean;
  isLive: boolean;
  savesUnfinished: boolean;
}): LeadCaptureStatus {
  const { draftHasContactStep, publishedHasContactStep, isLive, savesUnfinished } = input;

  if (publishedHasContactStep && isLive) {
    if (!savesUnfinished) {
      return {
        state: "paused",
        title: "Lead capture is limited",
        description:
          "This form has a contact step, but it isn't saving unfinished responses — so you only get contact details from people who submit. Turn on “Save unfinished responses” in Settings to keep the rest.",
      };
    }
    return {
      state: "on",
      title: "Lead capture is on",
      description: draftHasContactStep
        ? "Contact details are saved the moment a respondent passes that step — even if they never submit. You'll find them under Leads."
        : "The live form saves contact details the moment a respondent passes that step. Your draft no longer has the step — publish to turn lead capture off.",
    };
  }

  if (draftHasContactStep) {
    return {
      state: "needs_publish",
      title: "Lead capture is set up, but not live yet",
      description: isLive
        ? "Your draft has a contact step the live form doesn't. Publish your changes to start capturing leads."
        : "Your draft has a contact step. Publish the form to start capturing leads.",
    };
  }

  return {
    state: "off",
    title: "Lead capture is off",
    description:
      "Add a Contact info step before your last question to keep the details of people who don't finish.",
  };
}
