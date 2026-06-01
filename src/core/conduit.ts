import { Context } from "@hono/hono";
import type { Child, FC } from "@hono/hono/jsx";
import { DefaultLayout } from "./layout.tsx";

export type LayoutComponent = FC<{ children: Child }>;

export class Conduit {
  private layout: LayoutComponent;

  constructor(layout?: LayoutComponent) {
    this.layout = layout ?? DefaultLayout;
  }

  respond(
    c: Context,
    content: Child,
    opts?: { layout?: LayoutComponent },
  ): Response | Promise<Response> {
    const layout = opts?.layout ?? this.layout;
    const isHtmx = c.req.header("HX-Request") !== undefined;
    if (isHtmx) return c.html(content as unknown as string);
    return c.html(layout({ children: content }) as unknown as string);
  }
}
