import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import { NavLink, hasRole } from "@blenny/core/nav.tsx";
import type { UserInfo } from "@blenny/core/auth.ts";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { UserStore } from "@blenny/core/store.ts";
import type { BlennyModule } from "@blenny/types";

let conduit: Conduit;
let store: UserStore;

const DashboardPage: FC<{ userInfo: UserInfo; displayName: string }> = (
  { userInfo, displayName },
) => (
  <div>
    <h1>Dashboard</h1>
    <p>Welcome, {displayName}.</p>
    <nav style="margin:16px 0">
      <NavLink href="/dashboard" label="Dashboard" user={userInfo} />
      <NavLink
        href="/auth/profile"
        label="Profile"
        user={userInfo}
      />
      <NavLink
        href="/auth/change-password"
        label="Change Password"
        user={userInfo}
        requiredRoles="user"
      />
      <NavLink
        href="/admin/users"
        label="User Administration"
        user={userInfo}
        requiredRoles="admin"
      />
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
    store = state.store!;
  },
};

async function handleDashboard(c: Context) {
  const user = c.get("user") as UserInfo;
  const full = await store.findById(user.id);
  return conduit.respond(
    c,
    <DashboardPage
      userInfo={user}
      displayName={full?.displayName ?? user.id}
    />,
  );
}

export default dashboardModule;
