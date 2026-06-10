import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import { hasRole, type ComponentRegistry, type UIComponent } from "@blenny/core/component-registry.ts";
import type { UserInfo } from "@blenny/core/auth.ts";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { UserStore } from "@blenny/core/store.ts";
import type { BlennyModule } from "@blenny/types";

let conduit: Conduit;
let components: ComponentRegistry;
let store: UserStore;

const DashboardPage: FC<{ user: UserInfo; nav: UIComponent[]; displayName: string }> = (
  { user, nav, displayName },
) => (
  <div>
    <h1>Dashboard</h1>
    <p>Welcome, {displayName}.</p>
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
    components = state.components;
    store = state.store!;

    state.components.register({
      id: "nav.dashboard",
      type: "nav",
      label: "Dashboard",
      href: "/dashboard",
      group: "main",
      order: 10,
      visible: hasRole("user"),
    });
  },
};

async function handleDashboard(c: Context) {
  const user = c.get("user") as UserInfo;
  const full = await store.findById(user.id);
  const visible = components.getNavItems(user);
  return conduit.respond(
    c,
    <DashboardPage user={user} nav={visible} displayName={full?.displayName ?? user.id} />,
  );
}

export default dashboardModule;
