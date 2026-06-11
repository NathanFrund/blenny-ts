import { Context } from "@hono/hono";
import type { FC } from "@hono/hono/jsx";
import * as v from "@valibot/valibot";
import { PasswordSchema } from "@blenny/core/validation.ts";
import type { UserInfo } from "@blenny/core/auth.ts";
import { NavLink } from "@blenny/core/nav-link.tsx";
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
        action={`/admin/users/${user.id}/reset-password`}
        style="display:inline"
      >
        <input
          type="password"
          name="newPassword"
          placeholder="New pwd"
          required
          minLength={8}
        />
        <input
          type="password"
          name="confirmPassword"
          placeholder="Confirm"
          required
          minLength={8}
        />
        <button type="submit">Set</button>
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

const UsersPage: FC<{ users: StoredUser[]; userInfo?: UserInfo }> = (
  { users, userInfo },
) => (
  <div>
    <h1>User Administration</h1>
    <table>
      <thead>
        <tr>
          <th>Username</th>
          <th>Display Name</th>
          <th>Role</th>
          <th>Password</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => <UserRow key={u.id} user={u} />)}
      </tbody>
    </table>
    <nav>
      <NavLink href="/dashboard" label="Dashboard" user={userInfo} />
      <NavLink href="/auth/profile" label="Profile" user={userInfo} />
    </nav>
  </div>
);

async function handleListUsers(c: Context): Promise<Response> {
  const users = await store.findAll();
  const user = c.get("user") as UserInfo | undefined;
  return conduit.respond(c, <UsersPage users={users} userInfo={user} />);
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

async function handleResetPassword(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const newPassword = body.newPassword as string;
  const confirmPassword = body.confirmPassword as string;

  if (newPassword !== confirmPassword) {
    throw new Error("Passwords do not match");
  }

  const result = v.safeParse(PasswordSchema, newPassword);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  await store.setPassword(c.req.param("id")!, newPassword);
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
      path: "/admin/users/:id/reset-password",
      auth: "admin",
      handler: handleResetPassword,
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
  },
};

export default userAdminModule;
