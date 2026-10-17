import { test } from "bun:test";
import { DefaultLayout } from "@blenny/core/layout.tsx";
import { Hono } from "@hono/hono";
import type { FC } from "@hono/hono/jsx";
import { assertEquals } from "@std/assert";

const LayoutComponent = DefaultLayout as FC<{ children: unknown }>;

test("DefaultLayout", async () => {
  await step("renders HTML shell with slot content", async () => {
    const app = new Hono();
    app.get("/", (c) =>
      c.html(
        (
          <LayoutComponent>
            <p>hello</p>
          </LayoutComponent>
        ) as unknown as string,
      ),
    );

    const res = await app.request("http://localhost/");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes('<html lang="en">'), true);
    assertEquals(html.includes("<p>hello</p>"), true);
    assertEquals(html.includes("<meta"), true);
    assertEquals(html.includes("charset"), true);
  });

  await step("renders empty slot gracefully", async () => {
    const app = new Hono();
    app.get("/", (c) => c.html((<LayoutComponent>{""}</LayoutComponent>) as unknown as string));

    const res = await app.request("http://localhost/");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes('<html lang="en">'), true);
  });
});
