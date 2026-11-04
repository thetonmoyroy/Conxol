export function parseSessionFolderState(raw: string | null): Record<string, boolean> {
  try {
    if (!raw || raw.length > 100_000) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, open]) => key.length <= 512 && typeof open === "boolean").slice(0, 1000));
  } catch { return {}; }
}
