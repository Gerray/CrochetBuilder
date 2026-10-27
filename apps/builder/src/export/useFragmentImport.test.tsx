// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ShareDecodeError, type BuilderExport } from "@crochetbuilder/engine";
import { demoDocument, emptyDocument, type BuilderDoc } from "../state/document.js";
import { prepareExport } from "./prepare.js";
import { REPLACE_FROM_LINK_QUESTION, useFragmentImport } from "./useFragmentImport.js";

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

interface Pending {
  payload: string;
  resolve: (exp: BuilderExport) => void;
  reject: (err: unknown) => void;
}

/** A decoder whose results the test hands out in any order. */
function controlledDecode() {
  const pending: Pending[] = [];
  const decode = (payload: string) =>
    new Promise<BuilderExport>((resolve, reject) => {
      pending.push({ payload, resolve, reject });
    });
  return { pending, decode };
}

function Harness(props: {
  doc: BuilderDoc;
  decode: (payload: string) => Promise<BuilderExport>;
  log: { imported: string[]; notices: Array<string | undefined>; errors: string[]; questions: string[] };
}) {
  useFragmentImport({
    ready: true,
    doc: props.doc,
    decode: props.decode,
    onImport: (doc, _pinned, notice) => {
      props.log.imported.push(doc.title);
      props.log.notices.push(notice);
    },
    onError: (message) => props.log.errors.push(message),
    confirm: (question) => {
      props.log.questions.push(question);
      return true;
    },
  });
  return null;
}

const newLog = () => ({ imported: [] as string[], notices: [] as Array<string | undefined>, errors: [] as string[], questions: [] as string[] });

async function navigate(hash: string) {
  await act(async () => {
    history.replaceState(null, "", `/${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

const exportTitled = (title: string): BuilderExport => ({ ...prepareExport(demoDocument(ids(title), "ball")), title });

beforeEach(() => history.replaceState(null, "", "/"));
afterEach(() => cleanup());

describe("useFragmentImport", () => {
  it("two quick links: only the latest one is opened, and asked about once", async () => {
    const { pending, decode } = controlledDecode();
    const log = newLog();
    render(<Harness doc={demoDocument(ids("s"), "sphere")} decode={decode} log={log} />);
    await navigate("#data=v1.first");
    await navigate("#data=v1.second");
    expect(pending.map((p) => p.payload)).toEqual(["v1.first", "v1.second"]);

    // The newer link finishes first, the older one afterwards — the older one is dropped.
    await act(async () => pending[1]!.resolve(exportTitled("Zweiter")));
    await act(async () => pending[0]!.resolve(exportTitled("Erster")));
    expect(log.imported).toEqual(["Zweiter"]);
    expect(log.questions).toEqual([REPLACE_FROM_LINK_QUESTION]);
    expect(log.errors).toEqual([]);
  });

  it("a stale failure does not show an error for the link that worked", async () => {
    const { pending, decode } = controlledDecode();
    const log = newLog();
    render(<Harness doc={emptyDocument("r1")} decode={decode} log={log} />);
    await navigate("#data=v1.broken");
    await navigate("#data=v1.good");
    await act(async () => pending[1]!.resolve(exportTitled("Gut")));
    await act(async () => pending[0]!.reject(new ShareDecodeError("malformed", "x")));
    expect(log.imported).toEqual(["Gut"]);
    expect(log.errors).toEqual([]);
    expect(log.questions).toEqual([]);
  });

  it("passes the several-parts notice on", async () => {
    const { pending, decode } = controlledDecode();
    const log = newLog();
    render(<Harness doc={emptyDocument("r1")} decode={decode} log={log} />);
    await navigate("#data=v1.parts");
    const exp = exportTitled("Teile");
    exp.parts = [...exp.parts, { ...exp.parts[0]!, name: "Ohr", content: { schemaVersion: 1, rows: [] } }];
    await act(async () => pending[0]!.resolve(exp));
    expect(log.imported).toEqual(["Teile"]);
    expect(log.notices[0]).toMatch(/^Dieser Link enthält 2 Teile; der Builder bearbeitet bisher nur das erste\./);
  });
});
