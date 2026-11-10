import assert from "node:assert/strict";
import { createSavedWebSession } from "../src/saved-web-session.ts";

const fixture = { id: "00000000-0000-4000-8000-000000000001", name: " Office switch ", folder: " Office/Web ", url: "192.0.2.6:8080/login", pptpProfileId: "00000000-0000-4000-8000-000000000002" };
const web = createSavedWebSession(fixture);
assert.equal(web.name, "Office switch");
assert.equal(web.folder, "Office/Web");
assert.equal(web.protocol, "WEB");
assert.equal(web.hostname, "http://192.0.2.6:8080/login");
assert.equal(web.port, 8080);
assert.equal(createSavedWebSession({ ...fixture, url: "192.0.2.6:443/" }).hostname, "http://192.0.2.6:443/");
assert.equal(web.pptp_profile_id, fixture.pptpProfileId);
assert.deepEqual(web.auth, { kind: "none" });
assert.equal(createSavedWebSession({ ...fixture, url: "https://192.0.2.6/" }).port, 443);
assert.equal(createSavedWebSession({ ...fixture, url: "router.example.test" }).hostname, "https://router.example.test/");
assert.equal(createSavedWebSession({ ...fixture, url: "router" }).hostname, "https://router/");
for (const url of ["", "file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.test", "router setup"]) {
  assert.throws(() => createSavedWebSession({ ...fixture, url }));
}
assert.throws(() => createSavedWebSession({ ...fixture, name: " " }));
assert.throws(() => createSavedWebSession({ ...fixture, pptpProfileId: "" }));
