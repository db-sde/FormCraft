import { z } from "zod";

// Runs in the browser before the app's own code (Next.js loads this
// first). zod's fast path compiles parsers with `new Function`, and just
// probing for it is reported as a Content-Security-Policy violation
// (eval is blocked — see src/lib/http/csp.ts). Parsing works the same
// without it; it's a little slower, which no form here would notice.
z.config({ jitless: true });
