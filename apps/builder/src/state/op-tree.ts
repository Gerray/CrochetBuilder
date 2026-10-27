/**
 * Pure helpers to edit a row's recursive op tree by path.
 *
 * A path is a list of indices: `[2]` is the third op of the row, `[2, 0]` the first op
 * inside the repeat group at `[2]`. Every helper returns a new array and leaves its input
 * untouched; an invalid path returns the input unchanged.
 */

import type { Op, RepeatGroup } from "@crochetbuilder/engine";

export type OpPath = readonly number[];

/** The op at `path`, or undefined. */
export function getOp(ops: readonly Op[], path: OpPath): Op | undefined {
  let list: readonly Op[] = ops;
  let op: Op | undefined;
  for (let depth = 0; depth < path.length; depth++) {
    op = list[path[depth]!];
    if (!op) return undefined;
    if (depth < path.length - 1) {
      if (op.kind !== "repeat") return undefined;
      list = op.ops;
    }
  }
  return op;
}

/**
 * Apply `fn` to the op list addressed by `listPath` (`[]` = the row's ops, otherwise the
 * path of a repeat group). Returns `ops` unchanged when the path does not lead to a list.
 */
export function mapList(ops: Op[], listPath: OpPath, fn: (list: Op[]) => Op[]): Op[] {
  if (listPath.length === 0) return fn(ops);
  const [head, ...rest] = listPath;
  const target = ops[head!];
  if (!target || target.kind !== "repeat") return ops;
  const inner = mapList(target.ops, rest, fn);
  if (inner === target.ops) return ops;
  const next = [...ops];
  next[head!] = { ...target, ops: inner };
  return next;
}

function split(path: OpPath): { listPath: OpPath; index: number } | undefined {
  if (path.length === 0) return undefined;
  return { listPath: path.slice(0, -1), index: path[path.length - 1]! };
}

/** Replace the op at `path` with `fn(op)`. */
export function updateOp(ops: Op[], path: OpPath, fn: (op: Op) => Op): Op[] {
  const at = split(path);
  if (!at) return ops;
  return mapList(ops, at.listPath, (list) => {
    const op = list[at.index];
    if (!op) return list;
    const next = [...list];
    next[at.index] = fn(op);
    return next;
  });
}

/** Insert `op` so that it ends up at `path` (an index equal to the list length appends). */
export function insertOp(ops: Op[], path: OpPath, op: Op): Op[] {
  const at = split(path);
  if (!at) return ops;
  return mapList(ops, at.listPath, (list) => {
    if (at.index < 0 || at.index > list.length) return list;
    const next = [...list];
    next.splice(at.index, 0, op);
    return next;
  });
}

/**
 * Remove the op at `path`. A repeat group left empty is removed as well, so the tree never
 * contains `N× ()`.
 */
export function removeOp(ops: Op[], path: OpPath): Op[] {
  const at = split(path);
  if (!at || !getOp(ops, path)) return ops;
  const next = mapList(ops, at.listPath, (list) => list.filter((_, i) => i !== at.index));
  if (at.listPath.length > 0) {
    const parent = getOp(next, at.listPath);
    if (parent?.kind === "repeat" && parent.ops.length === 0) return removeOp(next, at.listPath);
  }
  return next;
}

/** Move the op at `path` by `delta` positions within its list (clamped). */
export function moveOp(ops: Op[], path: OpPath, delta: number): Op[] {
  const at = split(path);
  if (!at) return ops;
  return mapList(ops, at.listPath, (list) => {
    const op = list[at.index];
    const to = Math.max(0, Math.min(list.length - 1, at.index + delta));
    if (!op || to === at.index) return list;
    const next = [...list];
    next.splice(at.index, 1);
    next.splice(to, 0, op);
    return next;
  });
}

/** Wrap `length` ops starting at `path` into a repeat group worked `times` times. */
export function wrapInRepeat(ops: Op[], path: OpPath, times: number, length = 1): Op[] {
  const at = split(path);
  if (!at || length < 1) return ops;
  return mapList(ops, at.listPath, (list) => {
    if (at.index < 0 || at.index + length > list.length) return list;
    const group: RepeatGroup = { kind: "repeat", times, ops: list.slice(at.index, at.index + length) };
    const next = [...list];
    next.splice(at.index, length, group);
    return next;
  });
}

/** Replace the repeat group at `path` by its ops (worked once). */
export function unwrapRepeat(ops: Op[], path: OpPath): Op[] {
  const at = split(path);
  const group = getOp(ops, path);
  if (!at || group?.kind !== "repeat") return ops;
  return mapList(ops, at.listPath, (list) => {
    const next = [...list];
    next.splice(at.index, 1, ...group.ops);
    return next;
  });
}
