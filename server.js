const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 8000;
const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, "index.html");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp"
};

function sendFile(response, filePath, statusCode = 200) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";

  fs.readFile(filePath, (error, fileData) => {
    if (error) {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end("Not found");
      return;
    }

    response.writeHead(statusCode, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    response.end(fileData);
  });
}

const server = http.createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, HEAD"
    });
    response.end("Method not allowed");
    return;
  }

  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  let filePath;
  if (pathname === "/") {
    filePath = INDEX_PATH;
  } else {
    const safePath = path.normalize(pathname).replace(/^([/\\])+/g, "");
    filePath = path.join(ROOT_DIR, safePath);

    if (!filePath.startsWith(ROOT_DIR)) {
      sendFile(response, INDEX_PATH);
      return;
    }

    if (!path.extname(filePath)) {
      filePath = INDEX_PATH;
    }
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendFile(response, INDEX_PATH);
      return;
    }

    if (request.method === "HEAD") {
      const extension = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[extension] || "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      });
      response.end();
      return;
    }

    sendFile(response, filePath);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
