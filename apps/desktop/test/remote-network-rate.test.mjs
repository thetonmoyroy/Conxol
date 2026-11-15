import assert from "node:assert/strict";
import test from "node:test";
import { networkMbps } from "../src/remote-network-rate.ts";
const sample = (time, receivedBytes, transmittedBytes, name = "eth0") => ({ time, interfaces: [{ name, receivedBytes, transmittedBytes }] });
test("network rates convert bytes over actual elapsed time into decimal Mbps", () => {
  assert.deepEqual(networkMbps(sample(1000, 100, 200), sample(3000, 250100, 500200)), { received: 1, sent: 2 });
});
test("first sample and invalid sampling intervals have no invented speed", () => {
  assert.deepEqual(networkMbps(null, sample(1000, 100, 200)), { received: null, sent: null });
  assert.deepEqual(networkMbps(sample(1000, 100, 200), sample(1000, 200, 300)), { received: null, sent: null });
});
test("counter resets, newly added interfaces and loopback are excluded", () => {
  for (const current of [sample(2000, 1, 2), sample(2000, 200, 300, "new0")]) {
    assert.deepEqual(networkMbps(sample(1000, 100, 200), current), { received: null, sent: null });
  }
  assert.deepEqual(networkMbps(sample(1000, 0, 0, "lo"), sample(2000, 1000000, 1000000, "lo")), { received: null, sent: null });
});
