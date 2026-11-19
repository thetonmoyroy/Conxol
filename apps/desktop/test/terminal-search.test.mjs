import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalSearchTerm } from "../src/terminal-search.ts";

const formats = digits => [2, 4].flatMap(size =>
  [".", ":", "-"].map(separator => digits.match(new RegExp(`.{${size}}`, "g")).join(separator)));

test("each MAC format finds every format regardless of hex case", () => {
  for (const digits of ["000000000000", "a1b2c3d4e5f6"]) {
    for (const input of formats(digits)) {
      const search = terminalSearchTerm(` ${input.toUpperCase()} `, true);
      assert.equal(search.regex, true);
      assert.equal(search.caseSensitive, false);
      const regex = new RegExp(search.term, "gi");
      const output = formats(digits).flatMap(value => [value, value.toUpperCase()]).join("\n");
      assert.equal([...output.matchAll(regex)].length, 12);
      assert.equal(regex.test("a" + input + "b"), false);
      assert.equal(regex.test(formats("112233445566")[0]), false);
    }
  }
});

test("ordinary, partial, malformed and regex-like queries stay literal", () => {
  for (const query of ["host.example", "a1:b2:c3", "a1:b2-c3:d4:e5:f6", "a1b2.c3d4-e5f6", "gg:00:00:00:00:00", ".*", ""]) {
    for (const caseSensitive of [true, false]) {
      assert.deepEqual(terminalSearchTerm(query, caseSensitive), { term: query, regex: false, caseSensitive });
    }
  }
});
