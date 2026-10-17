import { test } from "bun:test";
import { PasswordSchema, SignalSchema, UserInfoSchema, UsernameSchema } from "@blenny/core/validation.ts";
import { assertEquals } from "@std/assert";
import * as v from "@valibot/valibot";

test("SignalSchema", async () => {
  await step("accepts a plain object", () => {
    const result = v.safeParse(SignalSchema, { key: "value", num: 42 });
    assertEquals(result.success, true);
  });

  await step("accepts an empty object", () => {
    const result = v.safeParse(SignalSchema, {});
    assertEquals(result.success, true);
  });

  await step("rejects an array", () => {
    const result = v.safeParse(SignalSchema, [1, 2, 3]);
    assertEquals(result.success, false);
  });

  await step("rejects null", () => {
    const result = v.safeParse(SignalSchema, null);
    assertEquals(result.success, false);
  });

  await step("rejects a string", () => {
    const result = v.safeParse(SignalSchema, "hello");
    assertEquals(result.success, false);
  });

  await step("rejects a number", () => {
    const result = v.safeParse(SignalSchema, 42);
    assertEquals(result.success, false);
  });
});

test("UsernameSchema", async () => {
  await step("accepts a valid username", () => {
    const result = v.safeParse(UsernameSchema, "john");
    assertEquals(result.success, true);
  });

  await step("rejects empty string", () => {
    const result = v.safeParse(UsernameSchema, "");
    assertEquals(result.success, false);
    assertEquals(result.issues?.[0]?.message, "Username is required");
  });

  await step("rejects string over 64 characters", () => {
    const result = v.safeParse(UsernameSchema, "a".repeat(65));
    assertEquals(result.success, false);
    assertEquals(result.issues?.[0]?.message.includes("64"), true);
  });

  await step("accepts string at max length", () => {
    const result = v.safeParse(UsernameSchema, "a".repeat(64));
    assertEquals(result.success, true);
  });
});

test("PasswordSchema", async () => {
  await step("accepts a valid password", () => {
    const result = v.safeParse(PasswordSchema, "secure123");
    assertEquals(result.success, true);
  });

  await step("rejects password under 8 characters", () => {
    const result = v.safeParse(PasswordSchema, "short");
    assertEquals(result.success, false);
    assertEquals(result.issues?.[0]?.message, "Password must be at least 8 characters");
  });

  await step("rejects password over 256 characters", () => {
    const result = v.safeParse(PasswordSchema, "a".repeat(257));
    assertEquals(result.success, false);
    assertEquals(result.issues?.[0]?.message.includes("256"), true);
  });

  await step("accepts password at min length", () => {
    const result = v.safeParse(PasswordSchema, "12345678");
    assertEquals(result.success, true);
  });
});

test("UserInfoSchema", async () => {
  await step("accepts valid user info", () => {
    const result = v.safeParse(UserInfoSchema, { id: "abc", role: "admin" });
    assertEquals(result.success, true);
  });

  await step("accepts user info with optional exp", () => {
    const result = v.safeParse(UserInfoSchema, {
      id: "abc",
      role: "user",
      exp: 1234567890,
    });
    assertEquals(result.success, true);
  });

  await step("rejects missing id", () => {
    const result = v.safeParse(UserInfoSchema, { role: "admin" });
    assertEquals(result.success, false);
  });

  await step("rejects missing role", () => {
    const result = v.safeParse(UserInfoSchema, { id: "abc" });
    assertEquals(result.success, false);
  });
});
