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
});

export type UserInfoData = v.InferOutput<typeof UserInfoSchema>;
