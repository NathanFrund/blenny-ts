import type { BlennyModule } from "@blenny/types";

const indexModule: BlennyModule = {
  name: "index",
  routes: [
    {
      method: "GET",
      path: "/",
      handler: (c) =>
        c.html(`
<!DOCTYPE html>
<html>
  <head><title>blenny-ts</title></head>
  <body>
    <h1>blenny-ts</h1>
    <p>A hypermedia-driven real-time platform.</p>
    <ul>
      <li><a href="/demo">Transport Demo</a></li>
      <li><a href="/dashboard">Dashboard</a></li>
    </ul>
  </body>
</html>
`),
    },
  ],
};

export default indexModule;
