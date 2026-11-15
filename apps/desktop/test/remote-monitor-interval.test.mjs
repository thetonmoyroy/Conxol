import assert from "node:assert/strict";
import test from "node:test";
import { readRemoteMonitorInterval, saveRemoteMonitorInterval } from "../src/remote-monitor.ts";
test("monitor starts at one second with no saved valid preference", () => {
  for (const value of [null, "", "0", "-1", "31", "60", "1.5", "bad", "NaN"]) {
    assert.equal(readRemoteMonitorInterval({ getItem: () => value }), 1);
  }
});
test("monitor remembers every allowed interval across reloads", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  for (let seconds = 1; seconds <= 30; seconds++) {
    saveRemoteMonitorInterval(seconds, storage);
    assert.equal(readRemoteMonitorInterval(storage), seconds);
  }
  saveRemoteMonitorInterval(0, storage);
  assert.equal(readRemoteMonitorInterval(storage), 30);
});
test("unavailable storage does not prevent monitoring", () => {
  assert.equal(readRemoteMonitorInterval({ getItem() { throw new Error("unavailable"); } }), 1);
  assert.doesNotThrow(() => saveRemoteMonitorInterval(5, { setItem() { throw new Error("unavailable"); } }));
});
