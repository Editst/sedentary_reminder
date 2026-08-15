import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("manifest.json security validation", () => {
  const manifestPath = path.resolve(__dirname, "../src/manifest.json");
  const manifestContent = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);

  assert.ok(
    !manifest.web_accessible_resources,
    "manifest.json should NOT contain web_accessible_resources to minimize fingerprinting surface"
  );
});
