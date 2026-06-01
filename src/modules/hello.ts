import { Hono } from "@hono/hono";
import type { BlennyModule } from "../types.ts";

const app = new Hono();

app.get("/", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>blenny-ts</title></head>
      <body>
        <h1>blenny-ts</h1>
        <p>A hypermedia-driven real-time platform.</p>
        <div id="tick"></div>
        <script type="module">
          const es = new EventSource("/sse");
          es.addEventListener("tick", (e) => {
            document.getElementById("tick").textContent =
              "tick: " + e.data;
          });
        </script>
      </body>
    </html>
  `);
});

const helloModule: BlennyModule = {
  name: "hello",
  routes: [
    { method: "GET", path: "/", handler: (c) => app.fetch(c.req.raw) },
    {
      method: "GET",
      path: "/hello",
      handler: (c) => c.text("hello from blenny-ts"),
    },
  ],
  subscriptions: [
    {
      topic: "spatial:tick",
      handler: (payload) => {
        const tick = payload as { cycle: number; activeAgents: number };
        console.log(`[hello] tick ${tick.cycle}, agents: ${tick.activeAgents}`);
      },
    },
  ],
};

export default helloModule;
