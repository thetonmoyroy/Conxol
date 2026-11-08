export function parseSessionFolderState(raw: string | null): Record<string, boolean> {
  try {
    if (!raw || raw.length > 100_000) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, open]) => key.length <= 512 && typeof open === "boolean").slice(0, 1000));
  } catch { return {}; }
}

export function parseSessionFolders(raw: string | null): string[] {
  try {
    if (!raw || raw.length > 100_000) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((name): name is string => typeof name === "string" && !!name.trim() && name.trim().length <= 128).map(name => name.trim()))].slice(0, 1000);
  } catch { return []; }
}

/** Clear folder assignments without deleting sessions or changing their metadata. */
export async function unfileSessionFolder<T extends { folder: string | null }>(
  folder: string,
  sessions: T[],
  save: (session: T) => Promise<unknown>,
): Promise<number> {
  const members = sessions.filter(session => session.folder?.trim() === folder.trim());
  for (const session of members) await save({ ...session, folder: null });
  return members.length;
}

/** Folder paths use /; existing single-level names remain unchanged. */
export function sessionFolderAncestors(folder: string): string[] {
  const result: string[] = [];
  for (let index = folder.indexOf("/"); index >= 0; index = folder.indexOf("/", index + 1)) {
    if (index > 0) result.push(folder.slice(0, index));
  }
  if (folder) result.push(folder);
  return result;
}

export function sessionFolderWithin(folder: string, parent: string): boolean {
  return folder === parent || folder.startsWith(`${parent}/`);
}

export function sessionFolderParent(folder: string): string {
  return folder.slice(0, Math.max(0, folder.lastIndexOf("/")));
}

export function sessionFolderOpenState(folder: string): Record<string, boolean> {
  return Object.fromEntries(sessionFolderAncestors(folder).map(path => [`folder:${path}`, true]));
}

export function groupSessionFolders<T extends { folder: string }>(sessions: T[], folders: string[] = []): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const folder of [...folders, ...sessions.map(session => session.folder.trim())]) {
    for (const path of sessionFolderAncestors(folder)) if (!groups.has(path)) groups.set(path, []);
  }
  for (const session of sessions) {
    const folder = session.folder.trim();
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(session);
  }
  return [...groups.entries()].sort(([first], [second]) => {
    if (!first) return second ? 1 : 0;
    if (!second) return -1;
    return first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Validate a subtree relocation before any saved session is written. */
export function planSessionFolderMove(original: string, name: string, folders: string[]): (path: string) => string {
  const renamed = (path: string) => sessionFolderWithin(path, original) ? name + path.slice(original.length) : path;
  if (!original || !name) throw new Error("A folder name is required.");
  if (name !== original && sessionFolderWithin(name, original)) throw new Error("A folder cannot be moved inside itself.");
  if (name !== original && folders.some(path => sessionFolderWithin(path, name) && !sessionFolderWithin(path, original))) throw new Error("A folder with that name already exists.");
  if ([original, ...folders].some(path => renamed(path).length > 128)) throw new Error("Nested folder paths must be 128 characters or fewer.");
  return renamed;
}
