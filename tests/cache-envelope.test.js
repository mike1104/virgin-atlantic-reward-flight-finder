const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("writeCache persists schema envelope and readCache loads data", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vao-cache-"));
  const cwd = process.cwd();
  process.chdir(tmpDir);

  try {
    delete require.cache[require.resolve("../dist/shared/utils/cache")];
    const cache = require("../dist/shared/utils/cache");
    cache.ensureDirs();

    cache.writeCache("sample.json", { ok: true });
    const raw = JSON.parse(fs.readFileSync(cache.getCachePath("sample.json"), "utf8"));

    assert.equal(raw.schemaVersion, 1);
    assert.equal(typeof raw.writtenAt, "string");
    assert.deepEqual(raw.data, { ok: true });

    const loaded = cache.readCache("sample.json", {
      validator: (value) => value && typeof value.ok === "boolean",
    });
    assert.deepEqual(loaded, { ok: true });
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("readCache rejects unversioned payloads", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vao-cache-legacy-"));
  const cwd = process.cwd();
  process.chdir(tmpDir);

  try {
    delete require.cache[require.resolve("../dist/shared/utils/cache")];
    const cache = require("../dist/shared/utils/cache");
    cache.ensureDirs();
    const filePath = cache.getCachePath("legacy.json");
    fs.writeFileSync(filePath, JSON.stringify({ legacy: true }));

    const blocked = cache.readCache("legacy.json");
    assert.equal(blocked, null);
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
