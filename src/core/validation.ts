import * as v from "@valibot/valibot";
export { escape as escapeHtml } from "@std/html/entities";

const isPlainObject = (input: unknown) =>
  typeof input === "object" && input !== null && !Array.isArray(input);

export const SignalSchema = v.pipe(
  v.any(),
  v.check(isPlainObject, "Expected a plain JSON object"),
  v.objectWithRest({}, v.unknown()),
);

export type SignalData = v.InferOutput<typeof SignalSchema>;

export const UsernameSchema = v.pipe(
  v.string(),
  v.minLength(1, "Username is required"),
  v.maxLength(64, "Username must be at most 64 characters"),
);

export const PasswordSchema = v.pipe(
  v.string(),
  v.minLength(8, "Password must be at least 8 characters"),
  v.maxLength(256, "Password must be at most 256 characters"),
);

export const UserInfoSchema = v.object({
  id: v.string(),
  role: v.string(),
  exp: v.optional(v.number()),
  roles: v.optional(v.array(v.string())),
});

export type UserInfoData = v.InferOutput<typeof UserInfoSchema>;

// ── Entity schemas ──────────────────────────────────────────────

export const UserSchema = v.object({
  username: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  passwordHash: v.string(),
  salt: v.string(),
  displayName: v.pipe(v.string(), v.minLength(1)),
  role: v.string(),
  avatarKey: v.optional(v.string()),
  createdAt: v.number(),
});

export type UserData = v.InferOutput<typeof UserSchema>;

export const NewUserSchema = v.object({
  username: UserSchema.entries.username,
  passwordHash: UserSchema.entries.passwordHash,
  salt: UserSchema.entries.salt,
  displayName: UserSchema.entries.displayName,
  role: v.optional(v.string(), "user"),
});

export type NewUser = v.InferOutput<typeof NewUserSchema>;
export type NewUserInput = v.InferInput<typeof NewUserSchema>;
