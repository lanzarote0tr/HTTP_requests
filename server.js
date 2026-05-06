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
    if (req.path === "/admin" || req.path.startsWith("/admin/")) {
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

app.get("/admin/data", (_req, res) => {
  res.json({
    count: requests.length,
    maxRequests,
    requests
  });
});

app.get("/admin", (_req, res) => {
  res.type("html").send(renderAdminPage(requests, maxRequests));
});

app.post("/admin/clear", (_req, res) => {
  requests.length = 0;
  res.status(204).end();
});

app.use((req, res) => {
  res.status(200).json({
    ok: true,
    message: "Webhook received. Open /admin to inspect webhook traffic.",
    method: req.method,
    path: req.originalUrl,
    receivedAt: new Date().toISOString()
  });
});

const server = app.listen(port, host, () => {
  console.log(`HTTP webhook listening on http://${host}:${port}`);
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
  <title>HTTP webhook</title>
  <style>
    body {
      margin: 0;
      font-family: sans-serif;
    }
    main {
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px;
      border-bottom: 1px solid #ccc;
    }
    .title-group {
      display: flex;
      align-items: baseline;
      gap: 12px;
      min-width: 0;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      white-space: nowrap;
    }
    .meta {
      font-size: 14px;
    }
    .clear-button {
      cursor: pointer;
      white-space: nowrap;
    }
    .layout {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(260px, 38%) minmax(0, 1fr);
    }
    .list {
      min-width: 0;
      overflow: auto;
      border-right: 1px solid #ccc;
    }
    .empty {
      padding: 12px;
    }
    .request-row {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(92px, 150px) minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      padding: 8px;
      border: 0;
      border-bottom: 1px solid #ddd;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .request-row.active {
      background: #ddd;
    }
    .request-row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
    }
    .detail {
      min-width: 0;
      overflow: auto;
      padding: 12px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    dt {
      font-weight: bold;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .detail-title {
      margin: 0 0 12px;
      overflow-wrap: anywhere;
    }
    details {
      margin: 8px 0;
    }
    summary {
      cursor: pointer;
    }
    pre {
      overflow: auto;
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
        border-bottom: 1px solid #ccc;
      }
      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div class="title-group">
        <h1>HTTP webhook</h1>
        <div class="meta"><span id="count">${items.length}</span> captured request${items.length === 1 ? "" : "s"}.</div>
      </div>
      <button id="clear-button" class="clear-button" type="button">Clear</button>
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
      selectedId: null,
      renderedDetailId: null
    };

    const listEl = document.getElementById("request-list");
    const detailEl = document.getElementById("detail");
    const countEl = document.getElementById("count");
    const clearButtonEl = document.getElementById("clear-button");

    render();
    clearButtonEl.addEventListener("click", clearRequests);
    setInterval(refreshRequests, 2000);

    async function clearRequests() {
      clearButtonEl.disabled = true;

      try {
        const response = await fetch("/admin/clear", { method: "POST" });
        if (!response.ok) return;

        state.requests = [];
        state.selectedId = null;
        state.renderedDetailId = null;
        countEl.textContent = "0";
        listEl.dataset.html = "";
        render();
      } finally {
        clearButtonEl.disabled = false;
      }
    }

    async function refreshRequests() {
      try {
        const response = await fetch("/admin/data", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        state.requests = data.requests;
        countEl.textContent = data.count;

        if (state.selectedId && !state.requests.some((item) => item.id === state.selectedId)) {
          state.selectedId = null;
          state.renderedDetailId = null;
          detailEl.innerHTML = '<div class="empty">Select a request to view details.</div>';
        }

        renderList();
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
      const nextListHtml = state.requests.map((item) => \`
        <button class="request-row" data-id="\${escapeHtml(item.id)}" type="button">
          <span title="\${escapeHtml(item.ip)}">\${escapeHtml(item.ip)}</span>
          <span title="\${escapeHtml(item.path)}">\${escapeHtml(item.path)}</span>
        </button>
      \`).join("");

      if (listEl.dataset.html !== nextListHtml) {
        listEl.innerHTML = nextListHtml;
        listEl.dataset.html = nextListHtml;

        listEl.querySelectorAll(".request-row").forEach((row) => {
          row.addEventListener("click", () => {
            state.selectedId = row.dataset.id;
            updateActiveRow();
            renderDetail();
          });
        });
      }

      updateActiveRow();
      listEl.scrollTop = scrollTop;
    }

    function updateActiveRow() {
      listEl.querySelectorAll(".request-row").forEach((row) => {
        row.classList.toggle("active", row.dataset.id === state.selectedId);
      });
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
