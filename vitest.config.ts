import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.{ts,tsx}"],
    // The jsdom app tests render the whole builder (2–3 s each on their own); with all files
    // running in parallel the 5 s default made them time out on a busy machine.
    testTimeout: 15_000,
    setupFiles: ["apps/builder/src/test/setup.ts"],
  },
});
