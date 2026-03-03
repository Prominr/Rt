const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 8000;
const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, "index.html");
const DEFAULT_PROXY_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

const BLOCKED_PROXY_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "set-cookie",
  "set-cookie2"
]);

const SKIP_PROXY_SCHEMES = /^(?:#|data:|blob:|javascript:|mailto:|tel:)/i;

function isHttpUrl(raw) {
  try {
    const parsed = new URL(String(raw || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function toProxyUrl(targetUrl) {
  return `/proxy?url=${encodeURIComponent(targetUrl)}`;
}

function toAbsoluteUrl(rawValue, baseUrl) {
  const value = String(rawValue || "").trim();
  if (!value || SKIP_PROXY_SCHEMES.test(value) || value.startsWith("/proxy?url=")) {
    return "";
  }

  try {
    if (value.startsWith("//")) {
      const protocol = new URL(baseUrl).protocol;
      return `${protocol}${value}`;
    }

    return new URL(value, baseUrl).toString();
  } catch (_error) {
    return "";
  }
}

function rewriteSrcsetValue(rawSrcset, baseUrl) {
  return String(rawSrcset)
    .split(",")
    .map((candidate) => {
      const chunk = candidate.trim();
      if (!chunk) {
        return "";
      }

      const parts = chunk.split(/\s+/);
      const source = parts[0];
      const absolute = toAbsoluteUrl(source, baseUrl);
      if (!absolute) {
        return chunk;
      }

      parts[0] = toProxyUrl(absolute);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

function rewriteCssUrls(cssText, baseUrl) {
  let rewritten = String(cssText || "");

  rewritten = rewritten.replace(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi, (fullMatch, _quote, rawValue) => {
    const absolute = toAbsoluteUrl(rawValue, baseUrl);
    if (!absolute) {
      return fullMatch;
    }
    return `url("${toProxyUrl(absolute)}")`;
  });

  rewritten = rewritten.replace(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi, (fullMatch, quote, rawValue) => {
    const absolute = toAbsoluteUrl(rawValue, baseUrl);
    if (!absolute) {
      return fullMatch;
    }
    return `@import ${quote}${toProxyUrl(absolute)}${quote}`;
  });

  return rewritten;
}

function rewriteHtmlDocument(html, baseUrl) {
  let rewritten = String(html || "");

  rewritten = rewritten.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, "");
  rewritten = rewritten.replace(/<meta[^>]+http-equiv=["']x-frame-options["'][^>]*>/gi, "");
  rewritten = rewritten.replace(/<base\b[^>]*>/gi, "");

  rewritten = rewritten.replace(/\b(src|href|action|poster)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi, (fullMatch, attr, wrappedValue, dqValue, sqValue, bareValue) => {
    const rawValue = dqValue ?? sqValue ?? bareValue ?? "";
    const absolute = toAbsoluteUrl(rawValue, baseUrl);
    if (!absolute) {
      return fullMatch;
    }

    const proxied = toProxyUrl(absolute);
    if (wrappedValue.startsWith("\"") && wrappedValue.endsWith("\"")) {
      return `${attr}="${proxied}"`;
    }

    if (wrappedValue.startsWith("'") && wrappedValue.endsWith("'")) {
      return `${attr}='${proxied}'`;
    }

    return `${attr}=${proxied}`;
  });

  rewritten = rewritten.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (fullMatch, wrappedValue, dqValue, sqValue) => {
    const rawValue = dqValue ?? sqValue ?? "";
    const proxied = rewriteSrcsetValue(rawValue, baseUrl);
    if (wrappedValue.startsWith("\"") && wrappedValue.endsWith("\"")) {
      return `srcset="${proxied}"`;
    }
    return `srcset='${proxied}'`;
  });

  rewritten = rewritten.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (fullMatch, wrappedValue, dqValue, sqValue) => {
    const rawStyle = dqValue ?? sqValue ?? "";
    const proxiedStyle = rewriteCssUrls(rawStyle, baseUrl);
    if (wrappedValue.startsWith("\"") && wrappedValue.endsWith("\"")) {
      return `style="${proxiedStyle}"`;
    }
    return `style='${proxiedStyle}'`;
  });

  rewritten = rewritten.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (fullMatch, attrs, cssBody) => {
    return `<style${attrs}>${rewriteCssUrls(cssBody, baseUrl)}</style>`;
  });

  rewritten = rewritten.replace(/(<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=)([^"']+)(["'][^>]*>)/gi, (fullMatch, prefix, rawValue, suffix) => {
    const absolute = toAbsoluteUrl(rawValue, baseUrl);
    if (!absolute) {
      return fullMatch;
    }
    return `${prefix}${toProxyUrl(absolute)}${suffix}`;
  });

  const runtimeBridge = `
<script>
(() => {
  const proxyPrefix = "/proxy?url=";
  const baseUrl = ${JSON.stringify(baseUrl)};
  const skipPattern = /^(?:#|data:|blob:|javascript:|mailto:|tel:)/i;

  function toAbsolute(raw) {
    const value = String(raw || "").trim();
    if (!value || skipPattern.test(value) || value.startsWith(proxyPrefix)) {
      return "";
    }
    try {
      if (value.startsWith("//")) {
        return new URL(baseUrl).protocol + value;
      }
      return new URL(value, baseUrl).toString();
    } catch (_error) {
      return "";
    }
  }

  function proxify(raw) {
    const absolute = toAbsolute(raw);
    return absolute ? (proxyPrefix + encodeURIComponent(absolute)) : raw;
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function(resource, init) {
      if (typeof resource === "string") {
        return nativeFetch.call(this, proxify(resource), init);
      }

      if (resource instanceof Request) {
        const proxiedRequest = new Request(proxify(resource.url), resource);
        return nativeFetch.call(this, proxiedRequest, init);
      }

      return nativeFetch.call(this, resource, init);
    };
  }

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return nativeXhrOpen.call(this, method, proxify(url), ...rest);
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    const link = target && target.closest ? target.closest("a[href]") : null;
    if (!link) {
      return;
    }
    const href = link.getAttribute("href");
    const proxied = proxify(href);
    if (proxied && proxied !== href) {
      link.setAttribute("href", proxied);
    }
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form || !form.getAttribute || !form.setAttribute) {
      return;
    }
    const action = form.getAttribute("action") || window.location.href;
    form.setAttribute("action", proxify(action));
  }, true);
})();
</script>`;

  if (/<head\b[^>]*>/i.test(rewritten)) {
    rewritten = rewritten.replace(/<head\b[^>]*>/i, (match) => `${match}${runtimeBridge}`);
  } else {
    rewritten = `${runtimeBridge}${rewritten}`;
  }

  return rewritten;
}

async function handleProxyRequest(request, response, requestUrl) {
  const targetUrl = requestUrl.searchParams.get("url") || "";
  if (!isHttpUrl(targetUrl)) {
    response.writeHead(400, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end("Invalid or missing proxy target URL.");
    return;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      redirect: "follow",
      headers: {
        "user-agent": request.headers["user-agent"] || DEFAULT_PROXY_USER_AGENT,
        "accept": request.headers.accept || "*/*",
        "accept-language": request.headers["accept-language"] || "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "referer": new URL(targetUrl).origin + "/"
      }
    });
  } catch (_error) {
    response.writeHead(502, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end("Failed to fetch target site.");
    return;
  }

  const responseHeaders = {
    "Cache-Control": "no-store"
  };

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (BLOCKED_PROXY_HEADERS.has(lower)) {
      return;
    }
    responseHeaders[key] = value;
  });

  const upstreamType = (upstream.headers.get("content-type") || "").toLowerCase();

  if (request.method === "HEAD") {
    response.writeHead(upstream.status, responseHeaders);
    response.end();
    return;
  }

  if (upstreamType.includes("text/html")) {
    const html = await upstream.text();
    const rewritten = rewriteHtmlDocument(html, targetUrl);
    responseHeaders["Content-Type"] = "text/html; charset=utf-8";
    response.writeHead(upstream.status, responseHeaders);
    response.end(rewritten);
    return;
  }

  if (upstreamType.includes("text/css")) {
    const css = await upstream.text();
    const rewrittenCss = rewriteCssUrls(css, targetUrl);
    responseHeaders["Content-Type"] = upstream.headers.get("content-type") || "text/css; charset=utf-8";
    response.writeHead(upstream.status, responseHeaders);
    response.end(rewrittenCss);
    return;
  }

  const data = await upstream.arrayBuffer();
  response.writeHead(upstream.status, responseHeaders);
  response.end(Buffer.from(data));
}

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

const server = http.createServer(async (request, response) => {
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

  if (pathname === "/proxy") {
    await handleProxyRequest(request, response, requestUrl);
    return;
  }

  let filePath;
  if (pathname === "/") {
    filePath = INDEX_PATH;
  } else {
    const safePath = path.normalize(pathname).replace(/^([/\\])+/g, "");
    filePath = path.resolve(ROOT_DIR, safePath);

    if (!filePath.toLowerCase().startsWith(ROOT_DIR.toLowerCase())) {
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
