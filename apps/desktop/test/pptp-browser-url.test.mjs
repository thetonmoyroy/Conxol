import assert from "node:assert/strict";
import console from "node:console";
import { browserDestination } from "../src/pptp-browser-url.ts";

assert.equal(browserDestination("192.168.88.1"), "http://192.168.88.1");
assert.equal(browserDestination(" 10.0.0.1:8080/login?next=/ "), "http://10.0.0.1:8080/login?next=/");
assert.equal(browserDestination("https://192.168.88.1"), "https://192.168.88.1");
assert.equal(browserDestination("http://router.example"), "http://router.example");
assert.equal(browserDestination("google.com"), "https://google.com");
assert.equal(browserDestination("router setup"), "https://www.google.com/search?q=router%20setup");
console.log("PPTP browser URL checks passed");
