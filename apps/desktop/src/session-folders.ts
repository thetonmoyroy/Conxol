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
