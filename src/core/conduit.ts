import { Context } from "@hono/hono";
import type { FC, Child } from "@hono/hono/jsx";
import { DefaultLayout } from "./layout.tsx";

export class Conduit {
  private layout: FC<{ children: Child }>;

  constructor(layout?: FC<{ children: Child }>) {
    this.layout = layout ?? DefaultLayout;
  }

  respond(c: Context, content: Child): Response | Promise<Response> {
    const isHtmx = c.req.header("HX-Request") !== undefined;
    if (isHtmx) return c.html(content as unknown as string);
    return c.html(this.layout({ children: content }) as unknown as string);
  }
}
