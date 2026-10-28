import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          // The jsdom tests render the whole builder (2–3 s each on their own); with every
          // file running in parallel the 5 s default is too tight on a busy machine.
          name: "app",
          include: ["apps/*/src/**/*.test.tsx"],
          testTimeout: 10_000,
        },
      },
    ],
  },
});
