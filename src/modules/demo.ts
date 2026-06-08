import type { TransportHub } from "../core/hub.ts";
import type { BlennyModule } from "@blenny/types";

let hub: TransportHub;
let intervalId: ReturnType<typeof setInterval>;
let toastCount = 0;

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
      method: "POST",
      path: "/demo/trigger",
      handler: async (c) => {
        const { intent } = await c.req.json() as { intent: string };
        const time = new Date().toLocaleTimeString();
        switch (intent) {
          case "ui": {
            toastCount++;
            const colors = [
              "#3fb950", "#58a6ff", "#f0883e", "#f85149", "#bc8cff",
            ];
            const color = colors[toastCount % colors.length];
            hub.patchElements(
              `<div id="toast-area">
                <div class="toast" style="border-color:${color}">
                  <span class="toast-dot" style="background:${color}"></span>
                  <span>Toast #${toastCount} at ${time}</span>
                </div>
              </div>`,
            );
            hub.mergeSignals({
              lastEvent: `UI — patched toast #${toastCount} at ${time}`,
            });
            break;
          }
          case "data": {
            const dice = Math.floor(Math.random() * 6) + 1;
            hub.mergeSignals({ dice });
            hub.mergeSignals({
              lastEvent: `Data — merged dice=${dice} at ${time}`,
            });
            break;
          }
          case "command": {
            hub.executeScript(
              `alert("Hello from the server!\\nCommand executed at ${time}")`,
            );
            hub.mergeSignals({
              lastEvent: `Command — executed script alert at ${time}`,
            });
            break;
          }
        }
        return c.json({ ok: true, intent });
      },
    },
  ],
  initialize(state) {
    hub = state.hub;
  },
  start() {
    intervalId = setInterval(() => {
      hub.mergeSignals({ currentTime: new Date().toLocaleTimeString() });
    }, 1000);
  },
  stop() {
    clearInterval(intervalId);
  },
};

const PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Blenny — Three-Intent Transport Demo</title>
    <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.1/bundles/datastar.js"></script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 720px; margin: 0 auto; }
      h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
      .subtitle { color: #8b949e; font-size: 0.875rem; margin-bottom: 1.5rem; }
      .card { margin-bottom: 1rem; padding: 1rem; background: #161b22; border: 1px solid #30363d; border-radius: 6px; }
      .card h2 { font-size: 1rem; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem; }
      .card p { font-size: 0.875rem; color: #8b949e; margin-bottom: 0.75rem; }
      .intent-tag { font-size: 0.7rem; font-weight: 400; padding: 0.125rem 0.375rem; border-radius: 3px; font-family: monospace; background: #21262d; border: 1px solid #30363d; }
      .btn { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
      .btn-ui { background: #3fb95022; color: #3fb950; border-color: #3fb950; }
      .btn-ui:hover { background: #3fb95033; }
      .btn-data { background: #58a6ff22; color: #58a6ff; border-color: #58a6ff; }
      .btn-data:hover { background: #58a6ff33; }
      .btn-cmd { background: #f0883e22; color: #f0883e; border-color: #f0883e; }
      .btn-cmd:hover { background: #f0883e33; }
      .clock-bar { padding: 0.75rem 1rem; background: #161b22; border: 1px solid #30363d; border-radius: 6px; font-size: 0.875rem; margin-bottom: 1rem; }
      .clock-bar .time { color: #3fb950; font-weight: 600; }
      .clock-bar .meta { color: #8b949e; font-size: 0.75rem; margin-left: 0.5rem; }
      .dice-value { font-size: 1.5rem; font-weight: 700; color: #58a6ff; }
      .result-row { display: flex; align-items: center; gap: 1rem; margin-top: 0.75rem; }
      .last-event { font-family: monospace; font-size: 0.8125rem; color: #a5d6ff; background: #0d1117; padding: 0.5rem 0.75rem; border-radius: 4px; border: 1px solid #21262d; }
      .toast { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; background: #0d1117; border: 1px solid; border-radius: 6px; margin-top: 0.75rem; font-size: 0.875rem; }
      .toast-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      ul { font-size: 0.8125rem; color: #8b949e; padding-left: 1.25rem; margin-top: 0.5rem; }
      ul li { margin-bottom: 0.25rem; }
      .tag { display: inline-block; padding: 0.125rem 0.375rem; border-radius: 3px; font-size: 0.75rem; font-family: monospace; background: #21262d; color: #8b949e; border: 1px solid #30363d; }
    </style>
  </head>
  <body>
    <h1>Three-Intent Transport Demo</h1>
    <p class="subtitle">
      A visual guide to the three transport intents: <code class="tag">ui</code>, <code class="tag">data</code>, and <code class="tag">command</code> — one-to-one with the Datastar wire operations.
    </p>

    <div
      data-init="@get('/sse?intent=ui,data,command')"
      data-signals='{"currentTime":"...","dice":0,"lastEvent":"Ready"}'>
    </div>

    <div class="clock-bar">
      <span>Server clock: <strong class="time" data-text="$currentTime"></strong></span>
      <span class="meta">(auto-pushed every 1s via <code>data</code> intent)</span>
    </div>

    <div class="card">
      <h2>UI <span class="intent-tag">patchElements</span></h2>
      <p>Delivers HTML fragments that Datastar merges into the DOM. Use for toasts, notifications, or partial page updates.</p>
      <button class="btn btn-ui" onclick="trigger('ui')">Send Toast</button>
      <div id="toast-area"></div>
    </div>

    <div class="card">
      <h2>Data <span class="intent-tag">mergeSignals</span></h2>
      <p>Merges structured data into the client signal store. Bound elements update reactively via <code class="tag">data-text</code>, <code class="tag">data-show</code>, etc.</p>
      <button class="btn btn-data" onclick="trigger('data')">Roll Dice</button>
      <div class="result-row">
        <span>Dice:</span>
        <span class="dice-value" data-text="$dice">0</span>
      </div>
    </div>

    <div class="card">
      <h2>Command <span class="intent-tag">executeScript</span></h2>
      <p>Executes JavaScript on connected clients. Use sparingly — only for actions that can't be expressed as HTML or signal merges.</p>
      <button class="btn btn-cmd" onclick="trigger('command')">Show Alert</button>
    </div>

    <div class="card">
      <h2>Event Log</h2>
      <div class="last-event" data-text="$lastEvent">Ready</div>
    </div>

    <div class="card">
      <h2>How it works</h2>
      <ul>
        <li>The page connects to SSE with <code class="tag">?intent=ui,data,command</code> — all three intents are available</li>
        <li>Each button sends a POST to <code class="tag">/demo/trigger</code> with the target intent</li>
        <li>The server calls the matching hub method, which routes to all connections subscribed to that intent</li>
        <li>The clock runs independently — <code class="tag">hub.mergeSignals({ currentTime })</code> every 1s as a <code>data</code> broadcast</li>
      </ul>
    </div>

    <script>
      function trigger(intent) {
        fetch("/demo/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent }),
        }).catch(function(e) {
          console.error("trigger failed", e);
        });
      }
    </script>
  </body>
</html>`;

export default demoModule;
