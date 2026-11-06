import assert from "node:assert/strict";
import { validWorkspacePin } from "../src/workspace-lock-state.ts";
for (const pin of ["1234", "0000", "839271", "123456789012"]) assert.equal(validWorkspacePin(pin), true, pin);
for (const pin of ["", "123", "1234567890123", "abcd", "１２３４", "12 34", "1234\n", "1234\r", " 1234", "1234 "]) assert.equal(validWorkspacePin(pin), false, JSON.stringify(pin));
