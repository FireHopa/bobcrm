import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createCompressionStream, isCompressibleContentType, selectContentEncoding } from "../httpCompression.js";

export function isPathInsideDirectory(parentDirectory, candidatePath) {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return contentTypes[extension] || "application/octet-stream";
}

export function createStaticAssetsHandler({ distDir, sendJson }) {
  return async function handleStatic(request, response, requestUrl) {
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      sendJson(response, 400, { ok: false, message: "Caminho de recurso estático inválido." });
      return;
    }
    if (pathname === "/") pathname = "/index.html";

    const candidatePath = path.resolve(distDir, `.${pathname}`);
    if (!isPathInsideDirectory(distDir, candidatePath)) {
      sendJson(response, 404, { ok: false, message: "Recurso estático não encontrado." });
      return;
    }

    const fallbackPath = path.join(distDir, "index.html");
    const filePath = existsSync(candidatePath) ? candidatePath : fallbackPath;

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");
      const isHashedAsset = path.basename(filePath).match(/-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/i);
      const contentType = getContentType(filePath);
      const encoding = fileStat.size >= 1024 && isCompressibleContentType(contentType)
        ? selectContentEncoding(request.headers["accept-encoding"])
        : "identity";
      const compressor = createCompressionStream(encoding);
      const headers = {
        "Content-Type": contentType,
        "Cache-Control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
      };
      if (compressor) {
        headers["Content-Encoding"] = encoding;
        headers.Vary = "Accept-Encoding";
      } else {
        headers["Content-Length"] = fileStat.size;
      }
      response.writeHead(200, headers);
      const source = createReadStream(filePath);
      await new Promise((resolve, reject) => {
        source.once("error", reject);
        response.once("error", reject);
        response.once("finish", resolve);
        if (compressor) source.pipe(compressor).pipe(response);
        else source.pipe(response);
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      sendJson(response, 404, { ok: false, message: "Front-end não encontrado. Rode npm run build ou use npm run dev para desenvolvimento." });
    }
  };
}
