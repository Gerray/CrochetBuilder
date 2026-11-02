import { describe, expect, it } from "vitest";
import { readTmcConfig } from "./config.js";
import { readRedirectParams, redirectTarget, withoutRedirectParams } from "./redirect.js";
import { errorLine, impactLines, lastUploadLine, uploadedWhen, waitText } from "./texts.js";

describe("configuration", () => {
  it("needs both values; empty and blank count as missing (an unset repository variable is empty)", () => {
    const ok = { VITE_TMC_SUPABASE_URL: "https://x.supabase.co/", VITE_TMC_SUPABASE_ANON_KEY: " key " };
    expect(readTmcConfig(ok)).toEqual({ url: "https://x.supabase.co", anonKey: "key" });
    expect(readTmcConfig({})).toBeNull();
    expect(readTmcConfig({ VITE_TMC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(readTmcConfig({ VITE_TMC_SUPABASE_ANON_KEY: "key" })).toBeNull();
    expect(readTmcConfig({ VITE_TMC_SUPABASE_URL: "", VITE_TMC_SUPABASE_ANON_KEY: "" })).toBeNull();
    expect(readTmcConfig({ VITE_TMC_SUPABASE_URL: "  ", VITE_TMC_SUPABASE_ANON_KEY: "key" })).toBeNull();
  });

  it("this test build has none", () => {
    expect(readTmcConfig()).toBeNull();
  });
});

describe("the return from Google", () => {
  it("goes back to the page without query and fragment", () => {
    expect(redirectTarget("https://gerray.github.io/CrochetBuilder/?x=1#data=v1.abc")).toBe("https://gerray.github.io/CrochetBuilder/");
    expect(redirectTarget("http://localhost:5190/")).toBe("http://localhost:5190/");
  });

  it("reads the code or a failure", () => {
    expect(readRedirectParams("?code=abc")).toEqual({ code: "abc", failed: false });
    expect(readRedirectParams("?error=access_denied&error_description=no")).toEqual({ code: null, failed: true });
    expect(readRedirectParams("")).toEqual({ code: null, failed: false });
  });

  it("takes only its own parameters out of the address; the fragment stays", () => {
    expect(withoutRedirectParams("https://a.test/b/?code=abc#data=v1.x")).toBe("/b/#data=v1.x");
    expect(withoutRedirectParams("https://a.test/b/?x=1&code=abc&state=s")).toBe("/b/?x=1");
    expect(withoutRedirectParams("https://a.test/b/?error=e&error_code=c&error_description=d")).toBe("/b/");
  });
});

describe("wording", () => {
  it("what an update costs, in correct singular and plural", () => {
    expect(impactLines({ progressMoved: 0, markersDropped: 0, partsDropped: 0 })).toEqual([]);
    expect(impactLines({ progressMoved: 1, markersDropped: 1, partsDropped: 1 })).toEqual([
      "1 Fortschritt wird verschoben",
      "1 Markierung entfällt",
      "1 Teil entfällt",
    ]);
    expect(impactLines({ progressMoved: 2, markersDropped: 3, partsDropped: 4 })).toEqual([
      "2 Fortschritte werden verschoben",
      "3 Markierungen entfallen",
      "4 Teile entfallen",
    ]);
  });

  it("waiting times", () => {
    expect(waitText(1)).toBe("1 Sekunde");
    expect(waitText(45)).toBe("45 Sekunden");
    expect(waitText(60)).toBe("1 Minute");
    expect(waitText(61)).toBe("2 Minuten");
    expect(waitText(720)).toBe("12 Minuten");
    expect(errorLine("rate-limited", 720)).toBe("Zu viele Uploads in kurzer Zeit. Versuche es in 12 Minuten noch einmal.");
    expect(errorLine("rate-limited")).toBe("Zu viele Uploads in kurzer Zeit. Versuche es später noch einmal.");
  });

  it("every code has a line of its own", () => {
    const codes = ["invalid", "unauthorized", "forbidden", "not-found", "conflict", "key-in-use", "too-large", "rate-limited", "network", "server"] as const;
    const lines = codes.map((code) => errorLine(code));
    expect(new Set(lines).size).toBe(codes.length);
    for (const line of lines) expect(line).toMatch(/\.$/);
  });

  it("the time of the last upload, by local calendar day", () => {
    const now = new Date(2026, 10, 2, 14, 40).getTime();
    expect(uploadedWhen(new Date(2026, 10, 2, 14, 32).getTime(), now)).toBe("heute, 14:32");
    expect(uploadedWhen(new Date(2026, 10, 2, 0, 5).getTime(), now)).toBe("heute, 00:05");
    expect(uploadedWhen(new Date(2026, 10, 1, 23, 59).getTime(), now)).toBe("gestern, 23:59");
    expect(uploadedWhen(new Date(2026, 9, 31, 9, 5).getTime(), now)).toBe("31.10.2026, 09:05");
    expect(uploadedWhen(new Date(2025, 10, 2, 14, 32).getTime(), now)).toBe("02.11.2025, 14:32");
    // Yesterday across a year boundary.
    expect(uploadedWhen(new Date(2025, 11, 31, 8, 0).getTime(), new Date(2026, 0, 1, 8, 0).getTime())).toBe("gestern, 08:00");
    expect(lastUploadLine(new Date(2026, 10, 2, 14, 32).getTime(), now)).toBe("Zuletzt hochgeladen: heute, 14:32");
  });
});
