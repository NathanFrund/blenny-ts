import type { Child, FC } from "@hono/hono/jsx";

export const DefaultLayout: FC<{ children: Child }> = (props) => (
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Blenny</title>
    </head>
    <body>{props.children}</body>
  </html>
);
