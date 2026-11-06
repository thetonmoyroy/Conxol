import assert from "node:assert/strict";
import { DoubleShift, shortcutSelectionText, shortcutFromSelection, isCommandShortcut, shortcutDevice, shortcutText, visibleDeviceShortcuts, withShortcutDevice } from "../src/command-shortcuts.ts";
const shortcut = (id, device, command = "show interfaces") => ({ id, title: id, description: "", command, variables: [], tags: withShortcutDevice([], device) });
const shared = shortcut("Shared", null), a = shortcut("Device A", "profile-a"), b = shortcut("Device B", "profile-b");
const snippet = { ...shared, id: "ordinary-snippet", tags: [] };
assert.equal(isCommandShortcut(shared), true);
assert.equal(isCommandShortcut(snippet), false);
assert.equal(shortcutDevice(a), "profile-a");
assert.deepEqual(visibleDeviceShortcuts([shared, b, snippet, a], "profile-a", "").map(item => item.id), [a.id, shared.id]);
assert.deepEqual(visibleDeviceShortcuts([shared, b, a], null, "").map(item => item.id), [shared.id]);
assert.deepEqual(visibleDeviceShortcuts([shared, a], "profile-a", "SHOW INTERFACES").map(item => item.id), [a.id, shared.id]);
assert.equal(visibleDeviceShortcuts([a], "profile-a", "missing").length, 0);
assert.deepEqual(withShortcutDevice(withShortcutDevice(["network"], "old"), "new"), ["network", "conxol:shortcut", "conxol:shortcut-device:new"]);
assert.deepEqual(withShortcutDevice(a.tags, null), ["conxol:shortcut"]);
assert.equal(shortcutText(a), "show interfaces", "paste must never append Enter");
for (const command of ["", "  ", "show\ninterfaces", "show\rinterfaces", "show\tinterfaces", "show\x1b[31m", "show\0", "x".repeat(65537)]) assert.equal(shortcutText(shortcut("invalid", null, command)), null);
assert.equal(shortcutText(shortcut("valid", null, "show interface {n}")), "show interface {n}", "shortcuts paste literal text without template expansion");
assert.equal(shortcutDevice(JSON.parse(JSON.stringify(a))), "profile-a", "device binding survives storage round trip");
const taps = new DoubleShift();
const shift = { key: "Shift", repeat: false, ctrlKey: false, altKey: false, metaKey: false };
function tap(time) { taps.keydown(shift); return taps.keyup("Shift", time); }
assert.equal(tap(100), false); assert.equal(tap(300), true);
assert.equal(tap(400), false, "a third tap must start a new pair");
taps.reset(); assert.equal(tap(1000), false); assert.equal(tap(1500), false);
taps.reset(); tap(2000); taps.keydown({ ...shift, key: "A" }); assert.equal(taps.keyup("A", 2050), false); assert.equal(tap(2100), false, "typing must reset a pending tap");
taps.reset(); tap(3000); taps.keydown({ ...shift, ctrlKey: true }); assert.equal(taps.keyup("Shift", 3100), false);
taps.reset(); assert.equal(taps.keyup("Shift", 4000), false, "keyup without keydown cannot trigger");
taps.keydown(shift); taps.keydown({ ...shift, repeat: true }); assert.equal(taps.keyup("Shift", 5000), false); assert.equal(taps.keyup("Shift", 5050), false);
taps.reset(); tap(6000); taps.reset(); assert.equal(tap(6100), false, "blur or pointer input clears pending taps");

// Selection is captured as an unsaved draft, scoped to the source pane's device.
const selectionDraft = shortcutFromSelection("selection-id", "  show interfaces\r\n", "source-device");
assert.equal(selectionDraft.command, "show interfaces");
assert.equal(selectionDraft.title, "", "user must name the shortcut before saving");
assert.equal(shortcutDevice(selectionDraft), "source-device");
assert.equal(isCommandShortcut(selectionDraft), true);
assert.equal(shortcutFromSelection("shared-id", "show version", null).tags.includes("conxol:shortcut"), true);
assert.equal(shortcutDevice(shortcutFromSelection("shared-id", "show version", null)), null);
for (const selection of ["", " \r\n ", "show version\nreload", "show\rreload", "show\x1b[31m", "show\tversion", "x".repeat(65537)]) {
  assert.equal(shortcutSelectionText(selection), null);
  assert.equal(shortcutFromSelection("invalid", selection, "source-device"), null);
}
assert.equal(shortcutSelectionText("show {n} | include interface"), "show {n} | include interface", "selected text is literal");
