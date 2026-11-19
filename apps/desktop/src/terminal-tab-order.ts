/** Move an existing tab before/after another without replacing session objects. */
export function moveTerminalTab<T extends { id: string }>(tabs: T[], sourceId: string, targetId: string, after = false): T[] {
  if (sourceId === targetId || !tabs.some(tab => tab.id === sourceId) || !tabs.some(tab => tab.id === targetId)) return tabs;
  const source = tabs.find(tab => tab.id === sourceId)!;
  const next = tabs.filter(tab => tab.id !== sourceId);
  next.splice(next.findIndex(tab => tab.id === targetId) + Number(after), 0, source);
  return next.every((tab, index) => tab === tabs[index]) ? tabs : next;
}
