interface OutputBuffer {
  length: number;
  getLine(index: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
}

/** Snapshot rendered text, joining soft wraps and preserving explicit newlines. */
export function terminalOutputText(buffer: OutputBuffer): string {
  const lines: string[] = [];
  let size = 0;
  for (let index = 0; index < buffer.length; index++) {
    const line = buffer.getLine(index);
    if (!line) continue;
    const nextWrapped = buffer.getLine(index + 1)?.isWrapped ?? false;
    const text = line.translateToString(!nextWrapped);
    size += text.length + 1;
    if (size > 16 * 1024 * 1024) throw new Error("Terminal output exceeds 16 MiB.");
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const result = lines.length ? lines.join("\n") + "\n" : "";
  if (new TextEncoder().encode(result).length > 16 * 1024 * 1024) throw new Error("Terminal output exceeds 16 MiB.");
  return result;
}

/** Local date/time and filesystem-safe connection identifiers. */
export function terminalOutputFilename(host?: string | null, bookmark?: string | null, now = new Date()): string {
  const part = (value: string | null | undefined, fallback: string) =>
    (value?.normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim().replace(/[. ]+$/g, "").slice(0, 64) || fallback);
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${date}_${time}_${part(host, "localhost")}_${part(bookmark, "terminal")}.txt`;
}
