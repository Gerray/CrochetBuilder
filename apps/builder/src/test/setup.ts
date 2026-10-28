/**
 * Vitest setup for the jsdom tests of the builder: `waitFor`/`findBy…` wait up to 5 s instead
 * of 1 s. Rendering the whole builder takes a while when every test file runs in parallel on
 * a busy machine; a test that really fails still fails, only later.
 */
if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 5_000 });
}

export {};
