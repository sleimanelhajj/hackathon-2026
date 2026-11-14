// House rules for the React UI that are easiest to check by reading the source.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const src = new URL("../../src/", import.meta.url);
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.tsx$/.test(d.name) ? [p] : [];
  });
}
const all = files(src.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

test("dropdowns use the shared Radix-based <Select>, never a native <select>", () => {
  const offenders = all.filter((f) => /<select[\s>]/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.basename(f)), []);
});

test("components don't hardcode colours (tokens only; brand logos excepted)", () => {
  const offenders = all
    .filter((f) => !/[\\/]ui\.tsx$/.test(f)) // Gmail logo paths
    .filter((f) => /#[0-9a-fA-F]{6}\b|rgba?\(\d/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.basename(f)), []);
});
