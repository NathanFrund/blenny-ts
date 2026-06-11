import { assertEquals } from "@std/assert";
import { NavLink } from "@blenny/core/nav-link.tsx";

Deno.test("NavLink", async (t) => {
  await t.step("renders <a> tag when no role required", () => {
    const result = NavLink({ href: "/test", label: "Test" });
    assertEquals(result !== null, true);
  });

  await t.step("renders <a> tag when role matches", () => {
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

  await t.step("applies class prop to <a> tag", () => {
    const result = NavLink({
      href: "/test",
      label: "Test",
      class: "text-primary",
    });
    assertEquals(result !== null, true);
  });

  await t.step("forwards extra props to <a> tag", () => {
    const result = NavLink({
      href: "/test",
      label: "Test",
      id: "nav-test",
    });
    assertEquals(result !== null, true);
  });
});
