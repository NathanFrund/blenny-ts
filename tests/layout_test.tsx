import { assertEquals } from "@std/assert";
import { DefaultLayout } from "@blenny/core/layout.tsx";
import { Hono } from "@hono/hono";
import type { FC } from "@hono/hono/jsx";

const LayoutComponent = DefaultLayout as FC<{ children: unknown }>;

Deno.test("DefaultLayout", async (t) => {
  await t.step("renders HTML shell with slot content", async () => {
    const app = new Hono();
    app.get("/", (c) =>
      c.html(
        (
          <LayoutComponent>
            <p>hello</p>
          </LayoutComponent>
        ) as unknown as string,
      ));

    const res = await app.request("http://localhost/");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("<html>"), true);
    assertEquals(html.includes("<p>hello</p>"), true);
    assertEquals(html.includes("<meta"), true);
    assertEquals(html.includes("charset"), true);
  });

  await t.step("renders empty slot gracefully", async () => {
    const app = new Hono();
    app.get("/", (c) =>
      c.html(
        // deno-lint-ignore jsx-curly-braces
        <LayoutComponent>{""}</LayoutComponent> as unknown as string,
      ));

    const res = await app.request("http://localhost/");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("<html>"), true);
  });
});
