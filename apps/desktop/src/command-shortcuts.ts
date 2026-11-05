export type ShortcutRecord = {
  id: string; title: string; description: string; command: string; tags: string[]; variables: string[];
};
const DEVICE_TAG = "conxol:shortcut-device:";
const SHORTCUT_TAG = "conxol:shortcut";
export const isCommandShortcut = (record: ShortcutRecord) => record.tags.includes(SHORTCUT_TAG);
export function shortcutDevice(record: ShortcutRecord): string | null {
  return record.tags.find(tag => tag.startsWith(DEVICE_TAG))?.slice(DEVICE_TAG.length) ?? null;
}
export function withShortcutDevice(tags: string[], device: string | null): string[] {
  return [...tags.filter(tag => !tag.startsWith(DEVICE_TAG) && tag !== SHORTCUT_TAG), SHORTCUT_TAG, ...(device ? [DEVICE_TAG + device] : [])];
}
export function shortcutText(record: ShortcutRecord): string | null {
  const text = record.command;
  // A shortcut is always a single line and must never inject control keys.
  return text.trim() && new TextEncoder().encode(text).length <= 65536 && ![...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ? text : null;
}
export function shortcutSelectionText(selection: string): string | null {
  const command = selection.trim();
  return shortcutText({ id: "", title: "", description: "", command, tags: [], variables: [] });
}
export function shortcutFromSelection(id: string, selection: string, device: string | null): ShortcutRecord | null {
  const command = shortcutSelectionText(selection);
  return command === null ? null : { id, title: "", description: "", command, tags: withShortcutDevice([], device), variables: [] };
}
export function visibleDeviceShortcuts(records: ShortcutRecord[], device: string | null, query: string) {
  const search = query.trim().toLowerCase();
  return records.filter(record => isCommandShortcut(record) && (!shortcutDevice(record) || shortcutDevice(record) === device) &&
    `${record.title} ${record.description} ${record.command}`.toLowerCase().includes(search))
    .sort((a, b) => Number(!!shortcutDevice(b)) - Number(!!shortcutDevice(a)) || a.title.localeCompare(b.title));
}
/** Two plain Shift taps; Shift+another key and held-key repeats never trigger. */
export class DoubleShift {
  private down = false;
  private previous = -Infinity;
  reset() { this.down = false; this.previous = -Infinity; }
  keydown(event: { key: string; repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }) {
    if (event.key !== "Shift" || event.ctrlKey || event.altKey || event.metaKey) { this.reset(); return; }
    if (!event.repeat) this.down = true;
  }
  keyup(key: string, now: number): boolean {
    if (key !== "Shift" || !this.down) { this.reset(); return false; }
    this.down = false;
    if (now - this.previous <= 400) { this.reset(); return true; }
    this.previous = now;
    return false;
  }
}
