/** First-party visitor id for A/B test assignment (P3.9): random, not
 * tied to an account or anything the respondent enters. */
export const VISITOR_COOKIE = "fc_vid";
export const VISITOR_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
/** Long enough for a visitor to keep their arm for a test's lifetime. */
export const VISITOR_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
