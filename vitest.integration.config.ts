import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // The webhook, Sheets and health tests sweep the same shared job
    // queues in one local database; run files one at a time so one
    // file's sweep can't pick up another's rows.
    fileParallelism: false,
  },
});
