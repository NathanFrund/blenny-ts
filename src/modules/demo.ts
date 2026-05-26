import type { TransportHub } from "../core/hub.ts";
import type { BlennyModule } from "../types.ts";

let hub: TransportHub;

const module: BlennyModule = {
  name: "demo",
  routes: [
    {
      method: "GET",
      path: "/demo",
      handler: () => {
        return new Response(PAGE, {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
    {
      method: "GET",
      path: "/trigger-broadcast",
      handler: (c) => {
        const category = c.req.query("category") || "none";
        const ts = Date.now();
        switch (category) {
          case "ui":
            hub.patchElements(
              `<div style="padding:0.5rem;background:#58a6ff22;border:1px solid #58a6ff;border-radius:4px">UI at ${ts}</div>`,
              { intent: "ui" },
            );
            break;
          case "data":
            hub.mergeSignals(
              { event: "data", timestamp: ts, value: Math.random() },
              { intent: "data" },
            );
            break;
          case "command":
            hub.executeScript(
              `console.log("command at ${ts}")`,
              { intent: "command" },
            );
            break;
          case "notification":
            hub.patchElements(
              `<div style="padding:0.5rem;background:#f0883e22;border:1px solid #f0883e;border-radius:4px">Notification at ${ts}</div>`,
              { intent: "notification" },
            );
            break;
        }
        return c.json({ ok: true, category });
      },
    },
    {
      method: "POST",
      path: "/demo/broadcast",
      handler: async (c) => {
        const { intent, html } = await c.req.json();
        hub.patchElements(html as string, { intent: intent as string | undefined });
        return c.json({ ok: true });
      },
    },
  ],
  initialize(state) {
    hub = state.hub;
  },
};

const PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Blenny — Connection Test</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
      h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
      p { color: #8b949e; font-size: 0.875rem; margin-bottom: 1.5rem; }
      .row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
      label { font-size: 0.875rem; color: #8b949e; }
      input, select { background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 0.375rem 0.5rem; color: #c9d1d9; font-size: 0.875rem; }
      select { cursor: pointer; }
      button { padding: 0.375rem 0.75rem; border: 1px solid #30363d; border-radius: 4px; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 0.875rem; }
      button:hover { background: #30363d; }
      .trigger-btn { min-width: 7rem; }
      #log { border: 1px solid #30363d; border-radius: 4px; height: 300px; overflow-y: scroll; padding: 0.5rem; font-family: monospace; font-size: 0.75rem; background: #161b22; }
      #log div { padding: 0.25rem 0; border-bottom: 1px solid #21262d; }
      #log .green { color: #3fb950; }
      #log .red { color: #f85149; }
      #log .blue { color: #58a6ff; }
      #log .orange { color: #f0883e; }
    </style>
  </head>
  <body>
    <h1>Connection Test</h1>
    <p>Connect via SSE or WebSocket and send events with different intents.</p>

    <div class="row">
      <label for="intent">Intent filter:</label>
      <input id="intent" type="text" value="" placeholder="e.g. ui,data" />
    </div>

    <div class="row">
      <label for="protocol">Protocol:</label>
      <select id="protocol">
        <option value="sse">Server-Sent Events (SSE)</option>
        <option value="ws">WebSocket</option>
      </select>
      <button onclick="connect()">Connect</button>
      <button onclick="disconnect()">Disconnect</button>
      <span id="status" style="font-size:0.75rem;color:#8b949e"></span>
    </div>

    <div class="row">
      <button class="trigger-btn" onclick="trigger('ui')">Send UI</button>
      <button class="trigger-btn" onclick="trigger('data')">Send Data</button>
      <button class="trigger-btn" onclick="trigger('command')">Send Command</button>
      <button class="trigger-btn" onclick="trigger('notification')">Send Notification</button>
    </div>

    <div id="log"></div>

    <script>
      let eventSource = null;
      let websocket = null;
      const logEl = document.getElementById("log");
      const statusEl = document.getElementById("status");

      function append(text, cls) {
        const div = document.createElement("div");
        div.className = cls || "green";
        div.textContent = text;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
      }

      function connect() {
        disconnect();
        const intent = document.getElementById("intent").value.trim();
        const protocol = document.getElementById("protocol").value;
        const token = new URLSearchParams(window.location.search).get("token") || new URLSearchParams(window.location.search).get("blenny_token");
        const parts = [];
        if (intent) parts.push("intent=" + encodeURIComponent(intent));
        if (token) parts.push("token=" + encodeURIComponent(token));
        const qs = parts.length ? "?" + parts.join("&") : "";
        statusEl.textContent = "Connecting...";

        if (protocol === "sse") {
          eventSource = new EventSource("/sse" + qs);
          eventSource.onopen = () => { append("SSE connected" + (intent ? " (filter: " + intent + ")" : "")); statusEl.textContent = "Connected (SSE)"; };
          eventSource.addEventListener("datastar-patch-elements", (e) => append("[html] " + e.data, "green"));
          eventSource.addEventListener("datastar-merge-signals", (e) => append("[data] " + e.data, "blue"));
          eventSource.addEventListener("datastar-execute-script", (e) => append("[script] " + e.data, "orange"));
          eventSource.onerror = () => { append("SSE connection error", "red"); statusEl.textContent = "Error"; };
        } else {
          const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws" + qs;
          websocket = new WebSocket(wsUrl);
          websocket.onopen = () => { append("WebSocket connected" + (intent ? " (filter: " + intent + ")" : "")); statusEl.textContent = "Connected (WS)"; };
          websocket.onmessage = (e) => { append("[ws] " + e.data, "green"); };
          websocket.onclose = () => { append("WebSocket disconnected", "red"); statusEl.textContent = "Disconnected"; };
          websocket.onerror = () => { append("WebSocket connection error", "red"); };
        }
      }

      function disconnect() {
        if (eventSource) { eventSource.close(); eventSource = null; append("SSE disconnected", "red"); }
        if (websocket) { websocket.close(1000); websocket = null; append("WebSocket disconnected", "red"); }
        statusEl.textContent = "Disconnected";
      }

      function trigger(category) {
        fetch("/trigger-broadcast?category=" + category).then(function(r) {
          if (!r.ok) append("trigger failed: " + r.status, "red");
        }).catch(function(e) {
          append("trigger error: " + e.message, "red");
        });
      }

      document.getElementById("protocol").addEventListener("change", function() { disconnect(); });
    </script>
  </body>
</html>`;

export default module;
