import { Context } from "@hono/hono";
import type { FC } from "@hono/hono/jsx";
import * as v from "@valibot/valibot";
import { hasRole } from "@blenny/core/component-registry.ts";
import { PasswordSchema } from "@blenny/core/validation.ts";
import type { UserInfo } from "@blenny/core/auth.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { BlennyModule } from "@blenny/types";

let conduit: Conduit;
let store: NonNullable<AppState["store"]>;

const ChangePasswordPage: FC<{ error?: string; success?: boolean }> = (
  { error, success },
) => (
  <div>
    <h1>Change Password</h1>
    {error && <p style="color:red">{error}</p>}
    {success && <p style="color:green">Password changed successfully.</p>}
    <form method="post" action="/auth/change-password">
      <label>
        Current Password
        <input type="password" name="currentPassword" required />
      </label>
      <br />
      <label>
        New Password
        <input type="password" name="newPassword" required />
      </label>
      <br />
      <label>
        Confirm New Password
        <input type="password" name="confirmPassword" required />
      </label>
      <br />
      <button type="submit">Change Password</button>
    </form>
    <p>
      <a href="/dashboard">Back to Dashboard</a>
    </p>
  </div>
);

function renderChangePassword(
  c: Context,
  error?: string,
  success?: boolean,
) {
  return conduit.respond(
    c,
    <ChangePasswordPage error={error} success={success} />,
  );
}

async function handleChangePassword(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const user = c.get("user") as UserInfo;
  const newPassword = body.newPassword as string;
  const confirmPassword = body.confirmPassword as string;

  if (newPassword !== confirmPassword) {
    return renderChangePassword(c, "Passwords do not match");
  }

  const result = v.safeParse(PasswordSchema, newPassword);
  if (!result.success) {
    return renderChangePassword(c, result.issues[0].message);
  }

  try {
    await store.changePassword(
      user.id,
      body.currentPassword as string,
      newPassword,
    );
    return renderChangePassword(c, undefined, true);
  } catch (err) {
    return renderChangePassword(
      c,
      err instanceof Error ? err.message : "Password change failed",
    );
  }
}

const passwordChangeModule: BlennyModule = {
  name: "password-change",
  requires: ["auth"],
  routes: [
    {
      method: "GET",
      path: "/auth/change-password",
      auth: true,
      handler: (c) => renderChangePassword(c),
    },
    {
      method: "POST",
      path: "/auth/change-password",
      auth: true,
      handler: handleChangePassword,
    },
  ],
  initialize(state_: AppState) {
    conduit = state_.conduit;
    store = state_.store!;
    state_.components.register({
      id: "nav.change-password",
      type: "nav",
      label: "Change Password",
      href: "/auth/change-password",
      group: "account",
      order: 20,
      visible: hasRole("user"),
    });
  },
};

export default passwordChangeModule;
