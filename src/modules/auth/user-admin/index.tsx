import { Context } from "@hono/hono";
import type { FC } from "@hono/hono/jsx";
import { hasRole } from "@blenny/core/component-catalog.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { StoredUser } from "@blenny/core/store.ts";
import type { BlennyModule } from "@blenny/types";

let conduit: Conduit;
let store: NonNullable<AppState["store"]>;

const UserRow: FC<{ user: StoredUser }> = ({ user }) => (
  <tr>
    <td>{user.username}</td>
    <td>{user.displayName}</td>
    <td>
      <form
        method="post"
        action={`/admin/users/${user.id}/role`}
        style="display:inline"
      >
        <select
          name="role"
          onChange={"this.form.submit()" as unknown as (e: Event) => void}
        >
          <option value="user" selected={user.role === "user"}>User</option>
          <option value="admin" selected={user.role === "admin"}>Admin</option>
        </select>
      </form>
    </td>
    <td>
      <form
        method="post"
        action={`/admin/users/${user.id}/delete`}
        style="display:inline"
        onSubmit={"return confirm('Delete this user?')" as unknown as (
          e: Event,
        ) => void}
      >
        <button type="submit">Delete</button>
      </form>
    </td>
  </tr>
);

const UsersPage: FC<{ users: StoredUser[] }> = ({ users }) => (
  <div>
    <h1>User Administration</h1>
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>Display Name</th>
          <th>Role</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => <UserRow key={u.id} user={u} />)}
      </tbody>
    </table>
    <p>
      <a href="/dashboard">Dashboard</a>
    </p>
  </div>
);

async function handleListUsers(c: Context): Promise<Response> {
  const users = await store.findAll();
  return conduit.respond(c, <UsersPage users={users} />);
}

async function handleUpdateRole(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  await store.updateRole(c.req.param("id")!, body.role as string);
  return c.redirect("/admin/users");
}

async function handleDeleteUser(c: Context): Promise<Response> {
  await store.deleteUser(c.req.param("id")!);
  return c.redirect("/admin/users");
}

const userAdminModule: BlennyModule = {
  name: "user-admin",
  requires: ["auth"],
  routes: [
    {
      method: "GET",
      path: "/admin/users",
      auth: "admin",
      handler: handleListUsers,
    },
    {
      method: "POST",
      path: "/admin/users/:id/role",
      auth: "admin",
      handler: handleUpdateRole,
    },
    {
      method: "POST",
      path: "/admin/users/:id/delete",
      auth: "admin",
      handler: handleDeleteUser,
    },
  ],
  initialize(state_: AppState) {
    conduit = state_.conduit;
    store = state_.store!;
    state_.components.register({
      id: "nav.user-admin",
      type: "nav",
      label: "User Administration",
      href: "/admin/users",
      group: "admin",
      order: 10,
      visible: hasRole("admin"),
    });
  },
};

export default userAdminModule;
