import test from "node:test";
import assert from "node:assert/strict";
import { isCompressibleContentType, selectContentEncoding, sendBufferResponse } from "./httpCompression.js";

test("negociação prefere Brotli, respeita q=0 e suporta gzip", () => {
  assert.equal(selectContentEncoding("gzip, br"), "br");
  assert.equal(selectContentEncoding("br;q=0, gzip;q=1"), "gzip");
  assert.equal(selectContentEncoding("deflate"), "identity");
});

test("somente conteúdos textuais e estruturados são comprimidos", () => {
  assert.equal(isCompressibleContentType("application/json; charset=utf-8"), true);
  assert.equal(isCompressibleContentType("text/css"), true);
  assert.equal(isCompressibleContentType("image/png"), false);
});

test("resposta pequena mantém Content-Length e não cria Content-Encoding", () => {
  const captured = {};
  const response = {
    writeHead(status, headers) { captured.status = status; captured.headers = headers; },
    end(body) { captured.body = body; },
  };
  sendBufferResponse({
    request: { headers: { "accept-encoding": "br" } },
    response,
    statusCode: 200,
    body: "ok",
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(captured.status, 200);
  assert.equal(captured.headers["Content-Length"], 2);
  assert.equal(captured.headers["Content-Encoding"], undefined);
});
