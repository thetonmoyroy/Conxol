export type FolderStyle = { icon: "folder" | "server" | "star" | "network"; color: string };
export const defaultFolderStyle: FolderStyle = { icon: "folder", color: "" };
export function readFolderStyles(raw: string | null): Record<string, FolderStyle> {
  try {
    if (!raw || raw.length > 100000) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).slice(0, 1000).filter(([name, value]) => name.length <= 128 && value && typeof value === "object" && ["folder", "server", "star", "network"].includes(value.icon) && (value.color === "" || /^#[0-9a-f]{6}$/i.test(value.color))));
  } catch { return {}; }
}
