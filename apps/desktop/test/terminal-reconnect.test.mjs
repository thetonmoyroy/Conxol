import assert from "node:assert/strict";
import { canReconnectTerminal, isReconnectKey } from "../src/terminal-reconnect.ts";
for (const protocol of ["ssh", "telnet", "serial"]) {
  for (const status of ["closed", "error"]) assert.equal(canReconnectTerminal(protocol, status), true);
  for (const status of ["connected", "starting", "reconnecting"]) assert.equal(canReconnectTerminal(protocol, status), false);
  assert.equal(canReconnectTerminal(protocol, "error", true), false);
}
for (const protocol of [null, "rdp", "vnc"]) assert.equal(canReconnectTerminal(protocol, "closed"), false);
const key = { key: "r", ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false };
assert.equal(isReconnectKey(key), true);
assert.equal(isReconnectKey({ ...key, key: "R" }), true);
for (const flag of ["ctrlKey", "metaKey", "altKey", "repeat", "isComposing"]) assert.equal(isReconnectKey({ ...key, [flag]: true }), false);
assert.equal(isReconnectKey({ ...key, key: "x" }), false);
