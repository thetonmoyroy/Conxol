export type SplitDirection = "none" | "right" | "down";

export type TerminalLayoutNode =
  | { kind: "pane"; terminalId: string }
  | { kind: "split"; direction: Exclude<SplitDirection, "none">; ratio: number; first: TerminalLayoutNode; second: TerminalLayoutNode };

export type SplitPathPart = "first" | "second";
export type SplitPath = SplitPathPart[];

export function layoutTerminalIds(node: TerminalLayoutNode): string[] {
  return node.kind === "pane" ? [node.terminalId] : [...layoutTerminalIds(node.first), ...layoutTerminalIds(node.second)];
}

export function findLayoutPath(node: TerminalLayoutNode, terminalId: string, path: SplitPath = []): SplitPath | null {
  if (node.kind === "pane") return node.terminalId === terminalId ? path : null;
  return findLayoutPath(node.first, terminalId, [...path, "first"]) ?? findLayoutPath(node.second, terminalId, [...path, "second"]);
}

export function replaceLayoutNode(node: TerminalLayoutNode, path: SplitPath, replacement: TerminalLayoutNode): TerminalLayoutNode {
  if (path.length === 0) return replacement;
  if (node.kind === "pane") return node;
  const [head, ...rest] = path;
  return head === "first"
    ? { ...node, first: replaceLayoutNode(node.first, rest, replacement) }
    : { ...node, second: replaceLayoutNode(node.second, rest, replacement) };
}

export function updateLayoutRatio(node: TerminalLayoutNode, path: SplitPath, ratio: number): TerminalLayoutNode {
  if (path.length === 0) return node.kind === "split" ? { ...node, ratio } : node;
  if (node.kind === "pane") return node;
  const [head, ...rest] = path;
  return head === "first"
    ? { ...node, first: updateLayoutRatio(node.first, rest, ratio) }
    : { ...node, second: updateLayoutRatio(node.second, rest, ratio) };
}

export function removeLayoutNode(node: TerminalLayoutNode, terminalId: string): TerminalLayoutNode | null {
  if (node.kind === "pane") return node.terminalId === terminalId ? null : node;
  const first = removeLayoutNode(node.first, terminalId);
  const second = removeLayoutNode(node.second, terminalId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function branchTerminalLayout(layout: TerminalLayoutNode, parentId: string, branchId: string): TerminalLayoutNode {
  if (layoutTerminalIds(layout).includes(branchId)) return layout;
  const path = findLayoutPath(layout, parentId);
  const split: TerminalLayoutNode = { kind: "split", direction: "right", ratio: 50, first: { kind: "pane", terminalId: parentId }, second: { kind: "pane", terminalId: branchId } };
  return path ? replaceLayoutNode(layout, path, split) : split;
}

export function rememberTerminalLayout(saved: Map<string, TerminalLayoutNode>, layout: TerminalLayoutNode) {
  for (const id of layoutTerminalIds(layout)) if (id) saved.set(id, layout);
}

export function selectTerminalLayout(current: TerminalLayoutNode, saved: Map<string, TerminalLayoutNode>, terminalId: string, liveIds: Set<string>): TerminalLayoutNode {
  if (layoutTerminalIds(current).includes(terminalId)) return current;
  const candidate = saved.get(terminalId);
  if (!candidate) return { kind: "pane", terminalId };
  let restored: TerminalLayoutNode | null = candidate;
  for (const id of layoutTerminalIds(candidate)) {
    if (!liveIds.has(id) || saved.get(id) !== candidate) restored = restored && removeLayoutNode(restored, id);
  }
  return restored ?? { kind: "pane", terminalId };
}
