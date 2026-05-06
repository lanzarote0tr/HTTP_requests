const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const maxRequests = Number(process.env.MAX_REQUESTS || 500);
const requests = [];

app.set("trust proxy", true);

app.use(express.raw({
  type: "*/*",
  limit: process.env.BODY_LIMIT || "2mb"
}));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const chunks = [];
  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function write(chunk, encoding, callback) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }
    return originalWrite.call(this, chunk, encoding, callback);
  };

  res.end = function end(chunk, encoding, callback) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }
    return originalEnd.call(this, chunk, encoding, callback);
  };

  res.on("finish", () => {
    if (req.path === "/admin" || req.path === "/admin.json") {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const responseBody = Buffer.concat(chunks);
    const requestBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    requests.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      method: req.method,
      protocol: req.protocol,
      host: req.get("host") || "",
      path: req.originalUrl,
      ip: req.ip,
      query: req.query,
      requestHeaders: req.headers,
      requestBody: formatBody(requestBody, req.get("content-type")),
      statusCode: res.statusCode,
      responseHeaders: res.getHeaders(),
      responseBody: formatBody(responseBody, res.getHeader("content-type")),
      durationMs: Number(durationMs.toFixed(2))
    });

    if (requests.length > maxRequests) {
      requests.length = maxRequests;
    }
  });

  next();
});

app.get("/admin.json", (_req, res) => {
  res.json({
    count: requests.length,
    maxRequests,
    requests
  });
});

app.get("/admin", (_req, res) => {
  res.type("html").send(renderAdminPage(requests, maxRequests));
});

app.use((req, res) => {
  res.status(200).json({
    ok: true,
    message: "Request recorded. Open /admin to inspect captured traffic.",
    method: req.method,
    path: req.originalUrl,
    receivedAt: new Date().toISOString()
  });
});

const server = app.listen(port, host, () => {
  console.log(`HTTP request recorder listening on http://${host}:${port}`);
  console.log(`Admin dashboard: http://${host}:${port}/admin`);
});

server.on("error", (error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});

function formatBody(buffer, contentType) {
  if (!buffer || buffer.length === 0) {
    return {
      size: 0,
      text: ""
    };
  }

  const type = String(contentType || "");
  const isTextLike = /^text\//i.test(type)
    || /json|xml|x-www-form-urlencoded|javascript/i.test(type);

  if (isTextLike) {
    return {
      size: buffer.length,
      text: buffer.toString("utf8")
    };
  }

  return {
    size: buffer.length,
    base64: buffer.toString("base64")
  };
}

function renderAdminPage(items, limit) {
  const rows = items.map((item) => `
    <article class="request">
      <header>
        <div>
          <span class="method">${escapeHtml(item.method)}</span>
          <span class="status">${item.statusCode}</span>
          <span class="url">${escapeHtml(`${item.protocol}://${item.host}${item.path}`)}</span>
        </div>
        <time>${escapeHtml(item.timestamp)}</time>
      </header>
      <dl class="summary">
        <div><dt>IP</dt><dd>${escapeHtml(item.ip)}</dd></div>
        <div><dt>Duration</dt><dd>${item.durationMs} ms</dd></div>
        <div><dt>Request Size</dt><dd>${item.requestBody.size} bytes</dd></div>
        <div><dt>Response Size</dt><dd>${item.responseBody.size} bytes</dd></div>
      </dl>
      <details open>
        <summary>Request headers</summary>
        <pre>${escapeHtml(JSON.stringify(item.requestHeaders, null, 2))}</pre>
      </details>
      <details>
        <summary>Request body</summary>
        <pre>${escapeHtml(bodyText(item.requestBody))}</pre>
      </details>
      <details>
        <summary>Response headers</summary>
        <pre>${escapeHtml(JSON.stringify(item.responseHeaders, null, 2))}</pre>
      </details>
      <details>
        <summary>Response body</summary>
        <pre>${escapeHtml(bodyText(item.responseBody))}</pre>
      </details>
    </article>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="3">
  <title>HTTP Request Recorder</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f6f8;
      color: #1f2933;
    }
    body {
      margin: 0;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }
    .topbar {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
    }
    .meta {
      color: #52606d;
      font-size: 14px;
    }
    .empty {
      padding: 28px;
      border: 1px solid #d9e2ec;
      background: #fff;
      border-radius: 8px;
      color: #52606d;
    }
    .request {
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      background: #fff;
      margin-bottom: 14px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }
    .request > header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 16px;
      border-bottom: 1px solid #e4e7eb;
      background: #fbfcfd;
    }
    .method, .status {
      display: inline-flex;
      align-items: center;
      min-width: 54px;
      justify-content: center;
      border-radius: 4px;
      padding: 3px 7px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      font-weight: 700;
    }
    .method {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .status {
      background: #dcfce7;
      color: #15803d;
    }
    .url {
      margin-left: 8px;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    time {
      white-space: nowrap;
      color: #52606d;
      font-size: 13px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0;
      margin: 0;
      border-bottom: 1px solid #e4e7eb;
    }
    .summary div {
      padding: 12px 16px;
      border-right: 1px solid #e4e7eb;
    }
    .summary div:last-child {
      border-right: 0;
    }
    dt {
      color: #52606d;
      font-size: 12px;
      margin-bottom: 4px;
    }
    dd {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    details {
      border-bottom: 1px solid #e4e7eb;
    }
    details:last-child {
      border-bottom: 0;
    }
    summary {
      cursor: pointer;
      padding: 11px 16px;
      font-weight: 650;
      font-size: 14px;
    }
    pre {
      margin: 0;
      padding: 14px 16px 18px;
      overflow: auto;
      background: #101828;
      color: #e5e7eb;
      font-size: 12px;
      line-height: 1.55;
    }
    @media (max-width: 760px) {
      .topbar, .request > header {
        align-items: flex-start;
        flex-direction: column;
      }
      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      time {
        white-space: normal;
      }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #0f172a;
        color: #e5e7eb;
      }
      .meta, time, dt {
        color: #9aa6b2;
      }
      .empty, .request {
        background: #111827;
        border-color: #334155;
      }
      .request > header {
        background: #1f2937;
        border-color: #334155;
      }
      .summary, .summary div, details {
        border-color: #334155;
      }
      pre {
        background: #020617;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>HTTP Request Recorder</h1>
      <div class="meta">${items.length} captured request${items.length === 1 ? "" : "s"}; keeping newest ${limit}. Auto-refreshes every 3s. JSON at <code>/admin.json</code>.</div>
    </div>
    ${items.length ? rows : '<div class="empty">No requests captured yet.</div>'}
  </main>
</body>
</html>`;
}

function bodyText(body) {
  if (body.text !== undefined) {
    return body.text;
  }

  if (body.base64 !== undefined) {
    return `[${body.size} bytes binary data, base64]\n${body.base64}`;
  }

  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
