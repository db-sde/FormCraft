/** Form password limits (F-48), shared by the settings UI and the
 * server. Kept apart from access.ts, which needs node:crypto. */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;
