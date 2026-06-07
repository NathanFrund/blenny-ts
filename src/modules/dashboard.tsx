import type { FC } from "@hono/hono/jsx";
import type { Conduit } from "../core/conduit.ts";
import type { BlennyModule } from "@blenny/types";

let conduit: Conduit;

const DashboardPage: FC<{ modules: number }> = (props) => (
  <div>
    <h1>Dashboard</h1>
    <p>Blenny-ts platform status.</p>
    <p>Modules loaded: {props.modules}</p>
    <p><a href="/auth/profile">Profile</a></p>
    <form method="post" action="/auth/signout" style="margin-top:16px">
      <button type="submit">Sign Out</button>
    </form>
  </div>
);

const dashboardModule: BlennyModule = {
  name: "dashboard",
  routes: [
    {
      method: "GET",
      path: "/dashboard",
      auth: true,
      handler: (c) => conduit.respond(c, <DashboardPage modules={3} />),
    },
  ],
  initialize(state) {
    conduit = state.conduit;
  },
};

export default dashboardModule;
