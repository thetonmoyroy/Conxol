/** A delayed clipboard read must never paste into a replaced or locked terminal. */
export async function pasteTerminalClipboard(read: () => Promise<string>, stillOwned: () => boolean, paste: (text: string) => Promise<void>): Promise<void> {
  if (!stillOwned()) return;
  const text = await read();
  if (!stillOwned() || !text) return;
  await paste(text);
}
