import type { TransportHub } from "../core/hub.ts";
import type { Intent } from "../core/envelope.ts";
import type { BlennyModule } from "@blenny/types";

let hub: TransportHub;

const demoModule: BlennyModule = {
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
        hub.patchElements(html as string, {
          intent: intent as Intent | undefined,
        });
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
    <title>Blenny — Datastar + WebSocket Demo</title>
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
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
      .panel { border: 1px solid #30363d; border-radius: 6px; padding: 0.75rem; }
      .panel h3 { font-size: 0.875rem; margin-bottom: 0.5rem; }
      .panel h3 span { color: #8b949e; font-weight: 400; font-size: 0.75rem; }
      #sse-log, #ws-log { border: 1px solid #21262d; border-radius: 4px; height: 250px; overflow-y: scroll; padding: 0.5rem; font-family: monospace; font-size: 0.75rem; background: #161b22; }
      #sse-log div, #ws-log div { padding: 0.25rem 0; border-bottom: 1px solid #21262d; white-space: pre-wrap; word-break: break-all; }
      .event-name { color: #79c0ff; }
      .data-line { color: #a5d6ff; }
      .meta { color: #8b949e; font-size: 0.625rem; }
      .green { color: #3fb950; }
      .red { color: #f85149; }
      .blue { color: #58a6ff; }
      .orange { color: #f0883e; }
    </style>
  </head>
  <body>
    <h1>Datastar + WebSocket</h1>
    <p>SSE uses the Datastar SDK for structured events. WS delivers bare payloads for HTMX clients.</p>

    <div class="row">
      <label for="intent">Intent filter:</label>
      <input id="intent" type="text" value="" placeholder="e.g. ui,data" />
    </div>

    <div class="row">
      <button onclick="connect()">Connect Both</button>
      <button onclick="disconnect()">Disconnect</button>
      <span id="status" style="font-size:0.75rem;color:#8b949e"></span>
    </div>

    <div class="row">
      <button class="trigger-btn" onclick="trigger('ui')">Send UI</button>
      <button class="trigger-btn" onclick="trigger('data')">Send Data</button>
      <button class="trigger-btn" onclick="trigger('command')">Send Command</button>
      <button class="trigger-btn" onclick="trigger('notification')">Send Notification</button>
    </div>

    <div class="grid">
      <div class="panel">
        <h3>SSE (Datastar SDK) <span>structured events</span></h3>
        <div id="sse-log"></div>
      </div>
      <div class="panel">
        <h3>WebSocket <span>bare payloads</span></h3>
        <div id="ws-log"></div>
      </div>
    </div>

    <script>
      let eventSource = null;
      let websocket = null;
      const sseLog = document.getElementById("sse-log");
      const wsLog = document.getElementById("ws-log");
      const statusEl = document.getElementById("status");

      function log(el, text, cls) {
        const div = document.createElement("div");
        if (cls) div.className = cls;
        div.textContent = text;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
      }

      function buildQs() {
        const intent = document.getElementById("intent").value.trim();
        const token = new URLSearchParams(window.location.search).get("token") || new URLSearchParams(window.location.search).get("blenny_token");
        const parts = [];
        if (intent) parts.push("intent=" + encodeURIComponent(intent));
        if (token) parts.push("token=" + encodeURIComponent(token));
        return parts.length ? "?" + parts.join("&") : "";
      }

      function connect() {
        disconnect();
        const qs = buildQs();
        statusEl.textContent = "Connecting...";

        // SSE — listens for Datastar SDK events
        eventSource = new EventSource("/sse" + qs);
        eventSource.onopen = () => {
          log(sseLog, "SSE connected to /sse");
          updateStatus();
        };
        eventSource.addEventListener("datastar-patch-elements", (e) => {
          log(sseLog, "event: datastar-patch-elements", "event-name");
          e.data.split("\\n").forEach(function(line) {
            log(sseLog, "data: " + line, "data-line");
          });
        });
        eventSource.addEventListener("datastar-patch-signals", (e) => {
          log(sseLog, "event: datastar-patch-signals", "event-name");
          e.data.split("\\n").forEach(function(line) {
            log(sseLog, "data: " + line, "data-line");
          });
        });
        eventSource.onerror = () => {
          log(sseLog, "SSE connection error", "red");
          updateStatus();
        };

        // WS — receives bare payloads
        const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws" + qs;
        websocket = new WebSocket(wsUrl);
        websocket.onopen = () => {
          log(wsLog, "WebSocket connected to /ws");
          updateStatus();
        };
        websocket.onmessage = (e) => {
          log(wsLog, e.data, "green");
        };
        websocket.onclose = () => {
          log(wsLog, "WebSocket disconnected", "red");
          updateStatus();
        };
        websocket.onerror = () => {
          log(wsLog, "WebSocket connection error", "red");
          updateStatus();
        };
      }

      function disconnect() {
        if (eventSource) { eventSource.close(); eventSource = null; log(sseLog, "SSE disconnected", "orange"); }
        if (websocket) { websocket.close(1000); websocket = null; log(wsLog, "WebSocket disconnected", "orange"); }
        statusEl.textContent = "Disconnected";
      }

      function updateStatus() {
        const sseOk = eventSource && eventSource.readyState === EventSource.OPEN;
        const wsOk = websocket && websocket.readyState === WebSocket.OPEN;
        const parts = [];
        if (sseOk) parts.push("SSE");
        if (wsOk) parts.push("WS");
        statusEl.textContent = parts.length ? "Connected: " + parts.join(", ") : "Disconnected";
      }

      function trigger(category) {
        fetch("/trigger-broadcast?category=" + category).catch(function(e) {
          log(sseLog, "trigger error: " + e.message, "red");
        });
      }
    </script>
  </body>
</html>`;

export default demoModule;
