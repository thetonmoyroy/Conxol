import assert from "node:assert/strict";
import { parseQuickConnectUri } from "../src/connection-uri.ts";
import {
  formatSessionEnvironment,
  parseSessionEnvironment,
} from "../src/session-environment.ts";
import { createTerminalHttpLinkProvider, findTerminalHttpUrls } from "../src/terminal-links.ts";
import { isMultilineTerminalPaste, shouldConfirmTerminalPaste } from "../src/terminal-paste.ts";
import { prepareTerminalPaste, settleTerminalWrites } from "../src/terminal-input.ts";
import { MAX_TERMINAL_TITLE_LENGTH, sanitizeTerminalTitle } from "../src/terminal-title.ts";
import { isCurrentSessionRequest } from "../src/session-request.ts";
import { terminalFontSizeAfterZoom } from "../src/terminal-zoom.ts";
import { countTextMatches, highlightRemoteCode, remoteEditorLanguage, remoteEditorSaveNotice, reloadRemoteEditorDocument, replaceTextMatches } from "../src/remote-editor.ts";
import { isRemoteMonitorRefreshInterval, REMOTE_MONITOR_REFRESH_INTERVALS } from "../src/remote-monitor.ts";
import { remoteChildPath, remoteParentPath } from "../src/remote-path.ts";
import { quoteRemotePromptPath } from "../src/remote-prompt.ts";
import { MAX_DROPPED_UPLOADS, normalizeDroppedUploadPaths } from "../src/transfer-input.ts";
assert.equal(isMultilineTerminalPaste("single line"), false);
assert.equal(isMultilineTerminalPaste("first\nsecond"), true);
assert.equal(isMultilineTerminalPaste("first\rsecond"), true);
assert.equal(isMultilineTerminalPaste("first\u2028second"), true);
assert.equal(isMultilineTerminalPaste("first\u2029second"), true);
assert.equal(shouldConfirmTerminalPaste("first\nsecond", true), true);
assert.equal(shouldConfirmTerminalPaste("single line", true), false);
assert.equal(shouldConfirmTerminalPaste("first\nsecond", false), false);
assert.equal(prepareTerminalPaste("first\r\nsecond\nthird", false), "first\rsecond\rthird");
assert.equal(prepareTerminalPaste("first\nsecond", true), "\x1b[200~first\rsecond\x1b[201~");
{
  let finishPending;
  let settled = false;
  const pending = new Promise((resolve) => { finishPending = resolve; });
  const result = settleTerminalWrites([Promise.reject(new Error("disconnected")), pending])
    .catch((error) => { settled = true; assert.equal(error.message, "disconnected"); });
  await Promise.resolve();
  assert.equal(settled, false, "a failed broadcast must await other writes");
  finishPending();
  await result;
  assert.equal(settled, true);
  await settleTerminalWrites([Promise.resolve(), Promise.resolve()]);
}

const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>&lt;already-encoded&gt;';
assert.equal(remoteEditorSaveNotice("/config.ini"), "Saved /config.ini.");
const cleanupNotice = remoteEditorSaveNotice("/config.ini", true);
assert.equal(cleanupNotice.startsWith("Saved /config.ini."), true, "cleanup trouble must not report the acknowledged save as failed");
assert.equal(cleanupNotice.includes("Backup cleanup could not be confirmed"), true);
assert.equal(cleanupNotice.includes("Inspect nearby .conxol-edit-backup files"), true);
for (const language of ["plain", "shell", "json", "yaml", "ini"]) {
  const rendered = highlightRemoteCode(hostile, language);
  assert.equal(rendered.includes("<img"), false, `${language} must not emit an image element`);
  assert.equal(rendered.includes("<script"), false, `${language} must not emit a script element`);
  assert.equal(rendered.includes('onerror="'), false, `${language} must not emit an event attribute`);
  assert.equal(rendered.includes("&lt;img"), true, `${language} must retain escaped remote markup`);
}

const highlighted = highlightRemoteCode('<script>ssh $USER --port=22</script>', "shell");
assert.equal(highlighted.includes('<span class="remote-editor-token-command">ssh</span>'), true);
assert.equal(highlighted.includes("<script"), false);
assert.equal(highlightRemoteCode("can't", "json"), "can&#39;t");
assert.equal(highlightRemoteCode("42", "json"), '<span class="remote-editor-token-number">42</span>');

assert.equal(remoteEditorLanguage("/tmp/settings.json"), "json");
assert.equal(remoteEditorLanguage("/tmp/SETTINGS.INI"), "ini");
assert.equal(remoteEditorLanguage("/tmp/profile"), "shell");
assert.equal(countTextMatches("İx.x", "x", false), 2);
assert.equal(replaceTextMatches("İx.x", "x", "$&", false), "İ$&.$&");
assert.equal(replaceTextMatches("İx.x", ".", "!", false), "İx!x");
assert.equal(replaceTextMatches("A a", "a", "b", true), "A b");
assert.deepEqual(REMOTE_MONITOR_REFRESH_INTERVALS, [15, 30, 60]);
assert.equal(isRemoteMonitorRefreshInterval(15), true);
assert.equal(isRemoteMonitorRefreshInterval(60), true);
assert.equal(isRemoteMonitorRefreshInterval(5), false);
assert.equal(isRemoteMonitorRefreshInterval(61), false);
assert.equal(remoteParentPath("/"), "/");
assert.equal(remoteParentPath("/file"), "/");
assert.equal(remoteParentPath("/tmp/"), "/");
assert.equal(remoteParentPath("/tmp/file "), "/tmp");
assert.equal(remoteParentPath("."), "..");
assert.equal(remoteParentPath(".."), "../..");
assert.equal(remoteParentPath("../.."), "../../..");
assert.equal(remoteParentPath("../folder"), "..");
assert.equal(remoteParentPath("./file"), ".");
assert.equal(remoteParentPath("file"), ".");
assert.equal(remoteChildPath("/", "renamed "), "/renamed ");
assert.equal(remoteChildPath(".", "renamed"), "./renamed");
assert.equal(remoteChildPath("/tmp/", "renamed"), "/tmp/renamed");
assert.equal(isCurrentSessionRequest(3, 3, "ssh-current", "ssh-current"), true);
assert.equal(isCurrentSessionRequest(2, 3, "ssh-current", "ssh-current"), false);
assert.equal(isCurrentSessionRequest(3, 3, "ssh-old", "ssh-current"), false);

assert.deepEqual(parseSessionEnvironment("TERM=xterm-256color\nLANG=C.UTF-8\n"), [
  ["TERM", "xterm-256color"],
  ["LANG", "C.UTF-8"],
]);
assert.equal(
  formatSessionEnvironment([["TERM", "xterm-256color"], ["LANG", "C.UTF-8"]]),
  "TERM=xterm-256color\nLANG=C.UTF-8",
);
assert.throws(() => parseSessionEnvironment("BAD-NAME=value"), /shell-safe NAME/);
assert.throws(() => parseSessionEnvironment("TERM=first\nTERM=second"), /unique/);
assert.throws(() => parseSessionEnvironment("TERM=bad\u0000value"), /invalid or too long/);
assert.throws(() => parseSessionEnvironment("TERM"), /NAME=value/);

assert.deepEqual(
  normalizeDroppedUploadPaths(["/tmp/a ", "", "   ", "/tmp/a", "/tmp/a ", "/tmp/b"]),
  ["/tmp/a ", "/tmp/a", "/tmp/b"],
);
assert.equal(
  normalizeDroppedUploadPaths(Array.from({ length: MAX_DROPPED_UPLOADS + 4 }, (_, index) => `/tmp/${index}`)).length,
  MAX_DROPPED_UPLOADS,
);

assert.deepEqual(findTerminalHttpUrls("See https://example.com/docs, then http://127.0.0.1:8080/ready."), [
  { text: "https://example.com/docs", start: 4, end: 28 },
  { text: "http://127.0.0.1:8080/ready", start: 35, end: 62 },
]);
assert.deepEqual(findTerminalHttpUrls("Do not open http://user:password@example.com or javascript:alert(1)."), []);
assert.equal(
  findTerminalHttpUrls(Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`).join(" ")).length,
  16,
);
for (const prefix of [["界", 2], ["e\u0301", 1]]) {
  const url = "https://example.com";
  const cells = [
    { chars: prefix[0], width: prefix[1] },
    ...Array.from({ length: prefix[1] - 1 }, () => ({ chars: "", width: 0 })),
    ...Array.from(url, (chars) => ({ chars, width: 1 })),
  ];
  const line = {
    length: cells.length,
    translateToString: () => prefix[0] + url,
    getCell: (column) => cells[column] && {
      getChars: () => cells[column].chars,
      getWidth: () => cells[column].width,
    },
  };
  let links;
  let activated;
  let requestedLine;
  createTerminalHttpLinkProvider((index) => { requestedLine = index; return line; }, (value) => { activated = value; })
    .provideLinks(1, (value) => { links = value; });
  assert.equal(requestedLine, 0);
  assert.deepEqual(links?.[0]?.range, {
    start: { x: prefix[1] + 1, y: 1 },
    end: { x: prefix[1] + url.length, y: 1 },
  });
  links?.[0]?.activate({}, "https://untrusted.invalid");
  assert.equal(activated, url);
}

assert.equal(terminalFontSizeAfterZoom(13, "increase"), 14);
assert.equal(terminalFontSizeAfterZoom(8, "decrease"), 8);
assert.equal(terminalFontSizeAfterZoom(32, "increase"), 32);
assert.equal(terminalFontSizeAfterZoom(24, "reset"), 13);
assert.equal(terminalFontSizeAfterZoom(Number.NaN, "increase"), 14);
assert.equal(sanitizeTerminalTitle("  app\u0007 · ready  "), "app · ready");
assert.equal(sanitizeTerminalTitle("\u0000\u001b[31mremote\u001b[0m"), "[31mremote[0m");
assert.equal(sanitizeTerminalTitle("build\u202eexe.txt\u2069\u0085"), "buildexe.txt");
assert.equal(sanitizeTerminalTitle("terminal 👩‍💻 جاهز"), "terminal 👩‍💻 جاهز");
assert.equal(sanitizeTerminalTitle("x".repeat(MAX_TERMINAL_TITLE_LENGTH + 20)).length, MAX_TERMINAL_TITLE_LENGTH);
assert.equal(quoteRemotePromptPath("/srv/report.txt"), '"/srv/report.txt"');
assert.equal(quoteRemotePromptPath("/srv/pay\u202ereport.txt\n"), '"/srv/pay\\u{202e}report.txt\\n"');
assert.equal(quoteRemotePromptPath("/srv/a\u2028b\u007f"), '"/srv/a\\u{2028}b\\u{7f}"');

// Reload must finish an approved read before the editor can replace its draft.
const reloadedDocument = { content: "server revision", encoding: "utf-8", revision: "new" };
let reloadConnected = true;
let reloadReads = 0;
let reloadApprovals = 0;
const reloadOptions = {
  dirty: true,
  confirmDiscard: async () => { reloadApprovals++; return true; },
  stillConnected: () => reloadConnected,
  read: async () => { reloadReads++; return reloadedDocument; },
};
assert.equal(await reloadRemoteEditorDocument(reloadOptions), reloadedDocument);
assert.equal(reloadReads, 1);
assert.equal(reloadApprovals, 1);
assert.equal(await reloadRemoteEditorDocument({ ...reloadOptions, confirmDiscard: async () => false }), null);
assert.equal(reloadReads, 1, "cancelled discard must not read or replace the draft");
assert.equal(await reloadRemoteEditorDocument({ ...reloadOptions, dirty: false }), reloadedDocument);
assert.equal(reloadApprovals, 1, "a clean buffer needs no discard approval");
reloadConnected = false;
await assert.rejects(reloadRemoteEditorDocument(reloadOptions), /connection changed or closed/);
assert.equal(reloadReads, 2, "a disconnected editor must not read");
reloadConnected = true;
await assert.rejects(reloadRemoteEditorDocument({
  ...reloadOptions,
  confirmDiscard: async () => { reloadConnected = false; return true; },
}), /connection changed or closed/);
assert.equal(reloadReads, 2, "a reconnect during approval must not use a replacement session");
reloadConnected = true;
let finishReloadRead;
const pendingReload = reloadRemoteEditorDocument({
  ...reloadOptions,
  dirty: false,
  read: () => new Promise(resolve => { finishReloadRead = resolve; }),
});
reloadConnected = false;
finishReloadRead(reloadedDocument);
await assert.rejects(pendingReload, /connection changed or closed/, "a late read must not replace the draft after connection loss");
reloadConnected = true;
const reloadReadFailure = new Error("bounded read failed");
await assert.rejects(reloadRemoteEditorDocument({
  ...reloadOptions,
  read: async () => { throw reloadReadFailure; },
}), error => error === reloadReadFailure, "read errors must reach the editor without a replacement document");

// Retired connection links must not silently fall back to another protocol.
for (const uri of ["rdp://fixture@192.0.2.1", "vnc://192.0.2.1"]) assert.throws(() => parseQuickConnectUri(uri), /Only ssh/);
assert.deepEqual(parseQuickConnectUri("ssh://ops@192.0.2.1"), { protocol: "ssh", host: "192.0.2.1", username: "ops", port: 22 });
assert.deepEqual(parseQuickConnectUri("telnet://192.0.2.1"), { protocol: "telnet", host: "192.0.2.1", username: "", port: 23 });
