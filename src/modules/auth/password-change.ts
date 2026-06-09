import { Context } from "@hono/hono";
import * as v from "@valibot/valibot";
import { PasswordSchema } from "@blenny/core/validation.ts";
import type { UserInfo } from "@blenny/core/auth.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { BlennyModule } from "@blenny/types";

let store: NonNullable<AppState["store"]>;

async function handleChangePassword(c: Context): Promise<Response> {
  const body = await c.req.json();
  const user = c.get("user") as UserInfo;
  const result = v.safeParse(PasswordSchema, body.newPassword);
  if (!result.success) {
    return c.json({ ok: false, error: result.issues[0].message }, 400);
  }
  try {
    await store.changePassword(user.id, body.currentPassword, body.newPassword);
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Password change failed",
      },
      400,
    );
  }
}

const passwordChangeModule: BlennyModule = {
  name: "password-change",
  routes: [
    {
      method: "POST",
      path: "/auth/change-password",
      auth: true,
      handler: handleChangePassword,
    },
  ],
  initialize(state_: AppState) {
    store = state_.store!;
  },
};

export default passwordChangeModule;
