import { assertEquals } from "@std/assert";
import { hasRole, NavLink } from "@blenny/core/nav.tsx";

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

  await t.step(
    "priority: roles array first, then effectiveRoles, then role",
    () => {
      const check = hasRole("commander");
      assertEquals(
        check({ id: "1", role: "user", roles: ["commander"] }),
        true,
      );
      assertEquals(
        check({ id: "1", role: "user", effectiveRoles: ["commander"] }),
        true,
      );
      assertEquals(check({ id: "1", role: "commander" }), true);
      assertEquals(check({ id: "1", role: "user" }), false);
    },
  );

  await t.step("multiple roles: any match is sufficient", () => {
    const check = hasRole("admin", "commander");
    assertEquals(check({ id: "1", role: "admin" }), true);
    assertEquals(check({ id: "1", role: "commander" }), true);
    assertEquals(check({ id: "1", role: "user" }), false);
  });
});

Deno.test("NavLink", async (t) => {
  await t.step("renders link when no role required", () => {
    const result = NavLink({ href: "/test", label: "Test" });
    assertEquals(result !== null, true);
  });

  await t.step("renders link when role matches", () => {
    const result = NavLink({
      href: "/admin",
      label: "Admin",
      requiredRoles: "admin",
      user: { id: "1", role: "admin" },
    });
    assertEquals(result !== null, true);
  });

  await t.step("returns null when role does not match", () => {
    const result = NavLink({
      href: "/admin",
      label: "Admin",
      requiredRoles: "admin",
      user: { id: "1", role: "user" },
    });
    assertEquals(result, null);
  });

  await t.step("accepts requiredRoles as array", () => {
    const result = NavLink({
      href: "/command",
      label: "Command",
      requiredRoles: ["admin", "commander"],
      user: { id: "1", role: "commander" },
    });
    assertEquals(result !== null, true);
  });

  await t.step("returns null when condition returns false", () => {
    const result = NavLink({
      href: "/beta",
      label: "Beta",
      user: { id: "1", role: "user" },
      condition: () => false,
    });
    assertEquals(result, null);
  });

  await t.step("renders link when condition returns true", () => {
    const result = NavLink({
      href: "/beta",
      label: "Beta",
      user: { id: "1", role: "user" },
      condition: () => true,
    });
    assertEquals(result !== null, true);
  });

  await t.step("role check and condition are both evaluated", () => {
    const result = NavLink({
      href: "/admin-beta",
      label: "Admin Beta",
      requiredRoles: "admin",
      user: { id: "1", role: "user" },
      condition: () => true,
    });
    assertEquals(result, null);
  });

  await t.step("renders link with icon", () => {
    const result = NavLink({
      href: "/dashboard",
      label: "Dashboard",
      icon: "lucide-home",
    });
    assertEquals(result !== null, true);
  });
});
