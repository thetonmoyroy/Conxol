/** Move an existing tab before/after another without replacing session objects. */
export function moveTerminalTab<T extends { id: string }>(tabs: T[], sourceId: string, targetId: string, after = false): T[] {
  if (sourceId === targetId || !tabs.some(tab => tab.id === sourceId) || !tabs.some(tab => tab.id === targetId)) return tabs;
  const source = tabs.find(tab => tab.id === sourceId)!;
  const next = tabs.filter(tab => tab.id !== sourceId);
  next.splice(next.findIndex(tab => tab.id === targetId) + Number(after), 0, source);
  return next.every((tab, index) => tab === tabs[index]) ? tabs : next;
}

/** Keep pinned tabs and the SSH transports required by surviving branches. */
export function bulkCloseTerminalIds(
  tabs: { id: string; pinned?: boolean; sharedSshParentId?: string }[],
  targetIds: string[],
): string[] {
  const parents = new Map(tabs.map(tab => [tab.id, tab.sharedSshParentId]));
  const targets = new Set(targetIds);
  const closing = new Set(tabs.filter(tab => !tab.pinned && targets.has(tab.id)).map(tab => tab.id));
  const retained = new Set<string>();
  for (const tab of tabs) {
    if (closing.has(tab.id)) continue;
    let parent = tab.sharedSshParentId;
    while (parent && !retained.has(parent)) {
      retained.add(parent);
      closing.delete(parent);
      parent = parents.get(parent);
    }
  }
  return [...closing];
}
