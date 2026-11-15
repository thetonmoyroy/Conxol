import assert from "node:assert/strict";
import test from "node:test";
import { filterPinInput, guardPinPaste, workspacePinInputProps } from "../src/workspace-pin-input.ts";

test("PIN input removes non-digits, retains leading zeros and preserves caret", () => {
  const field = { value: "00 a12! 34", selectionStart: 7, setSelectionRange(start, end) { this.selection = [start, end]; } };
  filterPinInput({ currentTarget: field });
  assert.equal(field.value, "001234");
  assert.deepEqual(field.selection, [4, 4]);
});
test("PIN input caps dropped or autofilled text at twelve digits", () => {
  const field = { value: "0123456789012345", selectionStart: 16, setSelectionRange() {} };
  filterPinInput({ currentTarget: field });
  assert.equal(field.value, "012345678901");
});
test("PIN paste rejects spaces, letters, punctuation and non-ASCII numerals", () => {
  for (const value of ["12 34", "1234 ", "12ab", "12!4", "１２３４"]) {
    let blocked = false;
    guardPinPaste({ clipboardData: { getData: () => value }, preventDefault() { blocked = true; } });
    assert.equal(blocked, true);
  }
  guardPinPaste({ clipboardData: { getData: () => "001234" }, preventDefault() { assert.fail("Digits should paste"); } });
});
test("PIN beforeinput blocks invalid typing without blocking deletion", () => {
  for (const data of [" ", "!", "a"]) {
    let blocked = false;
    workspacePinInputProps.onBeforeInput({ nativeEvent: { data }, preventDefault() { blocked = true; } });
    assert.equal(blocked, true);
  }
  for (const data of ["0", "9", null]) {
    workspacePinInputProps.onBeforeInput({ nativeEvent: { data }, preventDefault() { assert.fail("Valid input blocked"); } });
  }
});
