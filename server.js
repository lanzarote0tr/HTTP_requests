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
      ip: getDisplayIp(req),
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

function getDisplayIp(req) {
  const cloudflareIp = req.get("cf-connecting-ip");

  if (cloudflareIp) {
    return cloudflareIp.trim();
  }

  const forwardedFor = req.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip;
}

function renderAdminPage(items, limit) {
  const initialData = JSON.stringify({ requests: items, maxRequests: limit })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .topbar {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid #d9e2ec;
      background: #fff;
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
    .layout {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(260px, 38%) minmax(0, 1fr);
    }
    .list {
      min-width: 0;
      overflow: auto;
      border-right: 1px solid #d9e2ec;
      background: #fff;
    }
    .empty {
      padding: 20px;
      color: #52606d;
    }
    .request-row {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(92px, 150px) minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border: 0;
      border-bottom: 1px solid #e4e7eb;
      background: #fff;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .request-row:hover {
      background: #f8fafc;
    }
    .request-row.active {
      background: #e0f2fe;
      box-shadow: inset 3px 0 0 #0284c7;
    }
    .request-row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .detail {
      min-width: 0;
      overflow: auto;
      padding: 18px 20px 36px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 0 0 16px;
    }
    .summary div {
      padding: 10px 12px;
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      background: #fff;
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
    .detail-title {
      margin: 0 0 14px;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 15px;
    }
    details {
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      background: #fff;
      margin-bottom: 10px;
      overflow: hidden;
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
      main {
        height: auto;
        min-height: 100vh;
      }
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .layout {
        grid-template-columns: 1fr;
      }
      .list {
        max-height: 40vh;
        border-right: 0;
        border-bottom: 1px solid #d9e2ec;
      }
      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #0f172a;
        color: #e5e7eb;
      }
      .meta, dt {
        color: #9aa6b2;
      }
      .topbar, .list, .request-row, .summary div, details {
        background: #111827;
        border-color: #334155;
      }
      .request-row:hover {
        background: #1f2937;
      }
      .request-row.active {
        background: #0c4a6e;
        box-shadow: inset 3px 0 0 #38bdf8;
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
      <div class="meta"><span id="count">${items.length}</span> captured request${items.length === 1 ? "" : "s"}; keeping newest ${limit}. JSON at <code>/admin.json</code>.</div>
    </div>
    <section class="layout">
      <div id="request-list" class="list"></div>
      <div id="detail" class="detail"></div>
    </section>
  </main>
  <script>
    const initialData = ${initialData};
    const state = {
      requests: initialData.requests,
      selectedId: initialData.requests[0]?.id || null,
      renderedDetailId: null
    };

    const listEl = document.getElementById("request-list");
    const detailEl = document.getElementById("detail");
    const countEl = document.getElementById("count");

    render();
    setInterval(refreshRequests, 2000);

    async function refreshRequests() {
      try {
        const response = await fetch("/admin.json", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const previousSelection = state.selectedId;
        state.requests = data.requests;
        countEl.textContent = data.count;

        if (!state.requests.some((item) => item.id === previousSelection)) {
          state.selectedId = state.requests[0]?.id || null;
        }

        renderList();

        if (state.selectedId !== previousSelection || state.renderedDetailId === null) {
          renderDetail();
        }
      } catch (_error) {
      }
    }

    function render() {
      renderList();
      renderDetail();
    }

    function renderList() {
      if (!state.requests.length) {
        listEl.innerHTML = '<div class="empty">No requests captured yet.</div>';
        return;
      }

      const scrollTop = listEl.scrollTop;
      listEl.innerHTML = state.requests.map((item) => \`
        <button class="request-row \${item.id === state.selectedId ? "active" : ""}" data-id="\${escapeHtml(item.id)}" type="button">
          <span title="\${escapeHtml(item.ip)}">\${escapeHtml(item.ip)}</span>
          <span title="\${escapeHtml(item.path)}">\${escapeHtml(item.path)}</span>
        </button>
      \`).join("");

      listEl.querySelectorAll(".request-row").forEach((row) => {
        row.addEventListener("click", () => {
          state.selectedId = row.dataset.id;
          renderList();
          renderDetail();
        });
      });
      listEl.scrollTop = scrollTop;
    }

    function renderDetail() {
      const item = state.requests.find((request) => request.id === state.selectedId);

      if (!item) {
        detailEl.innerHTML = '<div class="empty">Select a request to view details.</div>';
        state.renderedDetailId = null;
        return;
      }

      state.renderedDetailId = item.id;
      detailEl.innerHTML = \`
        <h2 class="detail-title">\${escapeHtml(item.method)} \${escapeHtml(item.path)}</h2>
        <dl class="summary">
          <div><dt>IP</dt><dd>\${escapeHtml(item.ip)}</dd></div>
          <div><dt>Status</dt><dd>\${item.statusCode}</dd></div>
          <div><dt>Duration</dt><dd>\${item.durationMs} ms</dd></div>
          <div><dt>Time</dt><dd>\${escapeHtml(item.timestamp)}</dd></div>
        </dl>
        \${detailBlock("Request headers", JSON.stringify(item.requestHeaders, null, 2), true)}
        \${detailBlock("Request body", bodyText(item.requestBody), false)}
        \${detailBlock("Response headers", JSON.stringify(item.responseHeaders, null, 2), false)}
        \${detailBlock("Response body", bodyText(item.responseBody), false)}
      \`;
    }

    function detailBlock(title, value, open) {
      return \`
        <details \${open ? "open" : ""}>
          <summary>\${escapeHtml(title)}</summary>
          <pre>\${escapeHtml(value || "")}</pre>
        </details>
      \`;
    }

    function bodyText(body) {
      if (!body) return "";
      if (body.text !== undefined) return body.text;
      if (body.base64 !== undefined) return \`[\${body.size} bytes binary data, base64]\\n\${body.base64}\`;
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
  </script>
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
