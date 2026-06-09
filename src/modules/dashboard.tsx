import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import { type NavItem, NavRegistry } from "@blenny/core/nav-registry.ts";
import type { UserInfo } from "@blenny/core/auth.ts";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { BlennyModule } from "@blenny/types";

let conduit: Conduit;
let nav: NavRegistry;

const DashboardPage: FC<{ user: UserInfo; nav: NavItem[] }> = (
  { user, nav },
) => (
  <div>
    <h1>Dashboard</h1>
    <p>Welcome, {user.role}.</p>
    <nav style="margin:16px 0">
      {nav.map((item) => (
        <p key={item.href}>
          <a href={item.href}>{item.label}</a>
        </p>
      ))}
    </nav>
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
      handler: handleDashboard,
    },
  ],
  initialize(state: AppState) {
    conduit = state.conduit;
    nav = state.nav;
  },
};

function handleDashboard(c: Context) {
  const user = c.get("user") as UserInfo;
  const visible = nav.getVisibleFor(user);
  return conduit.respond(c, <DashboardPage user={user} nav={visible} />);
}

export default dashboardModule;
