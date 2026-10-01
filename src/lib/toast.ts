import { toast as sonner, type ExternalToast } from "sonner";

/** Errors stay up longer so there's time to read what went wrong (Part 1
 * §3: toasts hold 4s, errors 8s). Everything else is sonner's own. */
const ERROR_DURATION_MS = 8000;

const error: typeof sonner.error = (message, data?: ExternalToast) =>
  sonner.error(message, { duration: ERROR_DURATION_MS, ...data });

export const toast: typeof sonner = Object.assign(
  (...args: Parameters<typeof sonner>) => sonner(...args),
  sonner,
  { error },
);
