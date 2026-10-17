import { test } from "bun:test";
import { Conduit } from "@blenny/core/conduit.ts";
import { Context } from "@hono/hono";
import type { Child, FC } from "@hono/hono/jsx";
import { assertEquals } from "@std/assert";

const MiniLayout: FC<{ children: Child }> = (props) => (
  <html lang="en">
    <body>
      <nav>Nav</nav>
      {props.children}
    </body>
  </html>
);

test("Conduit", async () => {
  await step("renders full page with layout when not HTMX", async () => {
    const conduit = new Conduit(MiniLayout);
    const req = new Request("http://localhost/dashboard");
    const c = new Context(req);
    const resp = await conduit.respond(c, <h1>Hello</h1>);
    const html = await resp.text();

    assertEquals(html.includes('<html lang="en">'), true);
    assertEquals(html.includes("<nav>Nav</nav>"), true);
    assertEquals(html.includes("<h1>Hello</h1>"), true);
    assertEquals(html.includes("</body></html>"), true);
  });

  await step("renders fragment without layout when HTMX", async () => {
    const conduit = new Conduit(MiniLayout);
    const req = new Request("http://localhost/dashboard", {
      headers: { "HX-Request": "true" },
    });
    const c = new Context(req);
    const resp = await conduit.respond(c, <h1>Fragment</h1>);
    const html = await resp.text();

    assertEquals(html.includes('<html lang="en">'), false);
    assertEquals(html.includes("<nav>"), false);
    assertEquals(html.includes("<h1>Fragment</h1>"), true);
  });

  await step("uses default layout when none provided", async () => {
    const conduit = new Conduit();
    const req = new Request("http://localhost/");
    const c = new Context(req);
    const resp = await conduit.respond(c, <p>default</p>);
    const html = await resp.text();

    assertEquals(html.includes('<html lang="en">'), true);
    assertEquals(html.includes("<head>"), true);
    assertEquals(html.includes("<p>default</p>"), true);
  });

  await step("respond returns 200 Content-Type text/html", async () => {
    const conduit = new Conduit(MiniLayout);
    const req = new Request("http://localhost/");
    const c = new Context(req);
    const resp = await conduit.respond(c, <div>ok</div>);

    assertEquals(resp.status, 200);
    assertEquals(resp.headers.get("content-type")?.includes("text/html"), true);
  });
});
