const keys = ["conxol.sidebarWidth", "conxol.sessionFolders", "conxol.createdSessionFolders", "conxol.folderStyles", "conxol-theme"];
type Preferences = { workspaceId: string; preferences: Record<string, string> };
export function captureWorkspacePreferences(): Record<string, string> {
  return Object.fromEntries(keys.flatMap(key => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]]; }));
}
export function applyWorkspacePreferences(snapshot: Preferences) {
  for (const key of keys) { const value = snapshot.preferences[key]; if (typeof value === "string") localStorage.setItem(key, value); else localStorage.removeItem(key); }
  localStorage.setItem("conxol.restoredWorkspace", snapshot.workspaceId);
}
