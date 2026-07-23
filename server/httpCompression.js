import { Readable } from "node:stream";
import { createBrotliCompress, createGzip, constants as zlibConstants } from "node:zlib";

export function selectContentEncoding(acceptEncoding = "") {
  const accepted = String(acceptEncoding || "").toLowerCase();
  if (/(?:^|,)\s*br(?:\s*;\s*q=(?!0(?:\.0*)?\b)[0-9.]+)?(?:,|$)/.test(accepted)) return "br";
  if (/(?:^|,)\s*gzip(?:\s*;\s*q=(?!0(?:\.0*)?\b)[0-9.]+)?(?:,|$)/.test(accepted)) return "gzip";
  return "identity";
}

export function isCompressibleContentType(contentType = "") {
  return /^(?:text\/|application\/(?:json|javascript|xml|svg\+xml)|image\/svg\+xml)/i.test(String(contentType || ""));
}

export function createCompressionStream(encoding) {
  if (encoding === "br") {
    return createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
  }
  if (encoding === "gzip") return createGzip({ level: 6 });
  return null;
}

export function sendBufferResponse({ request, response, statusCode, body, headers = {}, compressionThreshold = 1024 }) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
  const contentType = String(headers["Content-Type"] || headers["content-type"] || "application/octet-stream");
  const encoding = buffer.length >= compressionThreshold && isCompressibleContentType(contentType)
    ? selectContentEncoding(request?.headers?.["accept-encoding"])
    : "identity";
  const compressor = createCompressionStream(encoding);
  const finalHeaders = { ...headers };

  if (compressor) {
    finalHeaders["Content-Encoding"] = encoding;
    finalHeaders.Vary = finalHeaders.Vary ? `${finalHeaders.Vary}, Accept-Encoding` : "Accept-Encoding";
  } else {
    finalHeaders["Content-Length"] = buffer.length;
  }

  response.writeHead(statusCode, finalHeaders);
  if (!compressor) {
    response.end(buffer);
    return;
  }

  const source = Readable.from([buffer]);
  const fail = (error) => response.destroy(error);
  source.once("error", fail);
  compressor.once("error", fail);
  source.pipe(compressor).pipe(response);
}
