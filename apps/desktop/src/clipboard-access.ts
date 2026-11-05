import { invoke } from "@tauri-apps/api/core";
import { isWorkspaceLocked } from "./workspace-lock-state";
const native = "__TAURI_INTERNALS__" in window;
export async function readClipboardText(): Promise<string> {
  if (isWorkspaceLocked()) throw new Error("Unlock the workspace before pasting.");
  return native ? invoke<string>("clipboard_read_text") : navigator.clipboard.readText();
}
export async function writeClipboardText(text: string): Promise<void> {
  if (isWorkspaceLocked()) throw new Error("Unlock the workspace before copying.");
  if (native) await invoke("clipboard_write_text", { text });
  else await navigator.clipboard.writeText(text);
}
