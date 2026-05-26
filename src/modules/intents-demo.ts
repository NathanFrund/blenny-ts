import { type TransportHub } from "../core/hub.ts";
import type { Intent } from "../core/envelope.ts";
import type { BlennyModule } from "../types.ts";

let hub: TransportHub;

const module: BlennyModule = {
  name: "intents-demo",
  routes: [
    {
      method: "GET",
      path: "/demo/intents",
      handler: () => {
        return new Response(HTML, {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
    {
      method: "POST",
      path: "/demo/broadcast",
      handler: async (c) => {
        const { intent, html } = await c.req.json();
        hub.patchElements(html as string, { intent: intent as Intent | undefined });
        return c.json({ ok: true });
      },
    },
  ],
  initialize(state) {
    hub = state.hub;
  },
};

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Blenny — Connection Intents Demo</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #8b949e; margin-bottom: 1.5rem; font-size: 0.875rem; }
  .controls { display: flex; gap: 0.5rem; margin-bottom: 2rem; flex-wrap: wrap; }
  button { padding: 0.5rem 1rem; border: 1px solid #30363d; border-radius: 6px;
    background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 0.875rem; }
  button:hover { background: #30363d; }
  button.ui { border-color: #58a6ff; }
  button.data { border-color: #3fb950; }
  button.command { border-color: #d2a8ff; }
  button.notification { border-color: #f0883e; }
  button.all { border-color: #8b949e; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .column { border: 1px solid #30363d; border-radius: 6px; padding: 1rem; min-height: 300px; }
  .column h3 { font-size: 0.875rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem;
    border-bottom: 1px solid #21262d; }
  .column h3 span { color: #8b949e; font-weight: 400; }
  .entry { background: #161b22; border-radius: 4px; padding: 0.5rem; margin-bottom: 0.5rem;
    font-size: 0.75rem; font-family: monospace; word-break: break-all; }
  .entry .meta { color: #8b949e; margin-bottom: 0.25rem; }
  .entry .intent-tag { display: inline-block; padding: 0.125rem 0.375rem; border-radius: 3px;
    font-size: 0.625rem; font-weight: 600; text-transform: uppercase; }
  .intent-ui { background: #58a6ff22; color: #58a6ff; }
  .intent-data { background: #3fb95022; color: #3fb950; }
  .intent-command { background: #d2a8ff22; color: #d2a8ff; }
  .intent-notification { background: #f0883e22; color: #f0883e; }
  .intent-none { background: #8b949e22; color: #8b949e; }
  .status { color: #8b949e; font-size: 0.75rem; margin-top: 1rem; text-align: center; }
</style>
</head>
<body>
  <h1>Connection Intents</h1>
  <p>Each column opens an SSE connection with a different <code>?intent=</code> filter.</p>

  <div class="controls">
    <button class="ui" data-intent="ui">Broadcast UI</button>
    <button class="data" data-intent="data">Broadcast Data</button>
    <button class="command" data-intent="command">Broadcast Command</button>
    <button class="notification" data-intent="notification">Broadcast Notification</button>
    <button class="all" data-intent="">Broadcast (no intent)</button>
  </div>

  <div class="grid">
    <div class="column" id="col-ui">
      <h3>?intent=ui <span>only UI</span></h3>
    </div>
    <div class="column" id="col-data">
      <h3>?intent=data,notification <span>data + notifications</span></h3>
    </div>
    <div class="column" id="col-all">
      <h3>no ?intent <span>receives all</span></h3>
    </div>
  </div>

  <div class="status" id="status">Connecting...</div>

<script>
  function connect(url, label, containerId) {
    const container = document.getElementById(containerId);
    const es = new EventSource(url);

    es.addEventListener("message", (e) => addEntry(container, label, e));
    es.addEventListener("datastar-patch-elements", (e) => addEntry(container, label, e));
    es.addEventListener("datastar-merge-signals", (e) => addEntry(container, label, e));
    es.addEventListener("datastar-execute-script", (e) => addEntry(container, label, e));

    es.onopen = () => updateStatus();
    es.onerror = () => updateStatus();
    return es;
  }

  function addEntry(container, label, event) {
    const el = document.createElement("div");
    el.className = "entry";

    let intentClass = "intent-none";
    let intentLabel = "none";
    let data = event.data;

    if (event.type === "datastar-patch-elements") { intentClass = "intent-ui"; intentLabel = "ui"; }
    else if (event.type === "datastar-merge-signals") { intentClass = "intent-data"; intentLabel = "data"; }
    else if (event.type === "datastar-execute-script") { intentClass = "intent-command"; intentLabel = "command"; }
    else if (event.type === "message") {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.intent) { intentLabel = parsed.intent; intentClass = "intent-" + parsed.intent; }
      } catch {}
    }

    el.innerHTML = '<div class="meta"><span class="intent-tag ' + intentClass + '">' + intentLabel
      + '</span> via ' + label + '</div>' + escapeHtml(data);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  let connections = [];

  function updateStatus() {
    const open = connections.filter(c => c.readyState === EventSource.OPEN).length;
    const total = connections.length;
    document.getElementById("status").textContent = open + "/" + total + " connections open";
  }

  connections.push(connect("/sse?intent=ui", "ui", "col-ui"));
  connections.push(connect("/sse?intent=data,notification", "data+notification", "col-data"));
  connections.push(connect("/sse", "all", "col-all"));
  updateStatus();

  document.querySelectorAll("[data-intent]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const intent = btn.dataset.intent || undefined;
      const label = intent || "no intent";
      btn.textContent = "Sending...";
      btn.disabled = true;
      await fetch("/demo/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, html: '<div class="alert">' + label + ' at ' + new Date().toLocaleTimeString() + '</div>' }),
      });
      btn.textContent = label === "no intent" ? "Broadcast (no intent)" : "Broadcast " + label.charAt(0).toUpperCase() + label.slice(1);
      btn.disabled = false;
    });
  });
</script>
</body>
</html>`;

export default module;
