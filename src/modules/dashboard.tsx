import type { FC } from "@hono/hono/jsx";
import type { Conduit } from "../core/conduit.ts";
import type { BlennyModule } from "../types.ts";

let conduit: Conduit;

const DashboardPage: FC<{ modules: number }> = (props) => (
  <div>
    <h1>Dashboard</h1>
    <p>Blenny-ts platform status.</p>
    <p>Modules loaded: {props.modules}</p>
  </div>
);

const moduleConfig: BlennyModule = {
  name: "dashboard",
  routes: [
    {
      method: "GET",
      path: "/dashboard",
      handler: (c) => conduit.respond(c, <DashboardPage modules={3} />),
    },
  ],
  initialize(state) {
    conduit = state.conduit;
  },
};

export default moduleConfig;
