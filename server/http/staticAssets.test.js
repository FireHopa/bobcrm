import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getContentType, isPathInsideDirectory } from "./staticAssets.js";

test("validação estática bloqueia traversal e aceita arquivos internos", () => {
  const root = path.resolve("/tmp/crm-dist");
  assert.equal(isPathInsideDirectory(root, path.join(root, "assets", "index-12345678.js")), true);
  assert.equal(isPathInsideDirectory(root, path.resolve(root, "..", "server", ".env")), false);
  assert.equal(isPathInsideDirectory(root, root), false);
});

test("content types incluem assets usados pelo build", () => {
  assert.equal(getContentType("index.html"), "text/html; charset=utf-8");
  assert.equal(getContentType("asset.woff2"), "font/woff2");
  assert.equal(getContentType("arquivo.bin"), "application/octet-stream");
});
