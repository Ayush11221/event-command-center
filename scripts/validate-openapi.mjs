import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const folder = new URL("../docs/api/", import.meta.url);
const files = (await readdir(folder)).filter((name) =>
  /^SLICE_.*OPENAPI\.json$/.test(name),
);
for (const file of files) {
  const doc = JSON.parse(await readFile(new URL(file, folder), "utf8"));
  assert.match(doc.openapi, /^3\./);
  assert.ok(doc.paths);
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.$ref) {
      assert.ok(
        value.$ref.startsWith("#/"),
        `${file}: external reference requires explicit review`,
      );
      let target = doc;
      for (const part of value.$ref.slice(2).split("/"))
        target = target?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
      assert.ok(target, `${file}: unresolved ${value.$ref}`);
    }
    Object.values(value).forEach(visit);
  }
  visit(doc);
}
console.log(
  `PASS: parsed ${files.length} OpenAPI documents; all local references resolve. Behavioral schema assertions run in backend/frontend contract tests.`,
);
