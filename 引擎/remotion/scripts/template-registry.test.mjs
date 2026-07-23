import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../../..");
const registry = JSON.parse(
  readFileSync(join(root, "模板/模板索引.json"), "utf8"),
);

test("模板索引中的每项都有匹配说明和画廊图片", () => {
  const ids = new Set();
  for (const entry of registry.templates) {
    assert.ok(!ids.has(entry.id), `duplicate template id ${entry.id}`);
    ids.add(entry.id);

    const manifestPath = join(root, entry.manifest);
    const previewPath = join(root, entry.preview);
    assert.ok(existsSync(manifestPath), `missing manifest ${entry.manifest}`);
    assert.ok(existsSync(previewPath), `missing preview ${entry.preview}`);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.id, entry.id);
    assert.equal(manifest.version, entry.version);
    assert.equal(manifest.compositionId, entry.compositionId);
    assert.ok(
      existsSync(join(root, manifest.exampleData)),
      `missing example data ${manifest.exampleData}`,
    );
  }
});
