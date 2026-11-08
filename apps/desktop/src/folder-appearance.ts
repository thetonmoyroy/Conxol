export const appearanceIcons = ["folder", "server", "star", "network", "router", "switch", "firewall", "access-point", "antenna", "ethernet", "load-balancer", "monitor", "terminal", "database", "cloud", "globe", "shield", "lock", "key", "wifi", "cable", "cpu", "drive", "building", "home", "wrench", "code", "layers", "box"] as const;
export type FolderStyle = { icon: typeof appearanceIcons[number]; color: string };
export const defaultFolderStyle: FolderStyle = { icon: "folder", color: "" };
export function readFolderStyles(raw: string | null): Record<string, FolderStyle> {
  try {
    if (!raw || raw.length > 100000) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).slice(0, 1000).filter(([name, value]) => name.length <= 128 && value && typeof value === "object" && (appearanceIcons as readonly string[]).includes(value.icon) && (value.color === "" || /^#[0-9a-f]{6}$/i.test(value.color))));
  } catch { return {}; }
}
