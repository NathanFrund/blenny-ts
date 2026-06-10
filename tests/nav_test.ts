import { assertEquals } from "@std/assert";
import { hasRole } from "@blenny/core/nav.tsx";

Deno.test("hasRole", async (t) => {
  await t.step("returns false for undefined user", () => {
    assertEquals(hasRole("admin")(undefined), false);
  });

  await t.step("checks singular role", () => {
    assertEquals(hasRole("admin")({ id: "1", role: "admin" }), true);
    assertEquals(hasRole("admin")({ id: "1", role: "user" }), false);
  });

  await t.step("checks roles array", () => {
    assertEquals(
      hasRole("commander")({ id: "1", role: "user", roles: ["commander"] }),
      true,
    );
    assertEquals(
      hasRole("commander")({ id: "1", role: "user", roles: ["admin"] }),
      false,
    );
  });

  await t.step("checks effectiveRoles", () => {
    assertEquals(
      hasRole("commander")(
        { id: "1", role: "user", effectiveRoles: ["commander"] },
      ),
      true,
    );
  });

  await t.step("priority: roles array first, then effectiveRoles, then role", () => {
    const check = hasRole("commander");
    assertEquals(check({ id: "1", role: "user", roles: ["commander"] }), true);
    assertEquals(
      check({ id: "1", role: "user", effectiveRoles: ["commander"] }),
      true,
    );
    assertEquals(check({ id: "1", role: "commander" }), true);
    assertEquals(check({ id: "1", role: "user" }), false);
  });

  await t.step("multiple roles: any match is sufficient", () => {
    const check = hasRole("admin", "commander");
    assertEquals(check({ id: "1", role: "admin" }), true);
    assertEquals(check({ id: "1", role: "commander" }), true);
    assertEquals(check({ id: "1", role: "user" }), false);
  });
});
