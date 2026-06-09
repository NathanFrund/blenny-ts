import { assertEquals } from "@std/assert";
import { NavRegistry } from "@blenny/core/nav-registry.ts";

Deno.test("NavRegistry", async (t) => {
  await t.step("returns nothing when empty", () => {
    const nav = new NavRegistry();
    assertEquals(nav.getVisibleFor({ role: "user" }), []);
  });

  await t.step("shows item with no roles to any user", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Home", href: "/" });
    assertEquals(nav.getVisibleFor({ role: "user" }).length, 1);
    assertEquals(nav.getVisibleFor(undefined).length, 1);
  });

  await t.step("shows item with matching role", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Admin Panel", href: "/admin", roles: ["admin"] });
    assertEquals(nav.getVisibleFor({ role: "admin" }).length, 1);
  });

  await t.step("hides item with non-matching role", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Admin Panel", href: "/admin", roles: ["admin"] });
    assertEquals(nav.getVisibleFor({ role: "user" }).length, 0);
  });

  await t.step("hides item from anonymous user when roles present", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Profile", href: "/profile", roles: ["user"] });
    assertEquals(nav.getVisibleFor(undefined).length, 0);
  });

  await t.step("shows item when effectiveRoles matches", () => {
    const nav = new NavRegistry();
    nav.register({
      label: "Commander View",
      href: "/command",
      roles: ["commander"],
    });
    const user = { role: "user", effectiveRoles: ["commander"] };
    assertEquals(nav.getVisibleFor(user).length, 1);
  });

  await t.step("hides item when effectiveRoles does not match", () => {
    const nav = new NavRegistry();
    nav.register({
      label: "Commander View",
      href: "/command",
      roles: ["commander"],
    });
    const user = { role: "user", effectiveRoles: ["referee"] };
    assertEquals(nav.getVisibleFor(user).length, 0);
  });

  await t.step("effectiveRoles takes priority over role", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Super Only", href: "/super", roles: ["super"] });
    // user.role is "admin" but effectiveRoles is ["super"]
    const user = { role: "admin", effectiveRoles: ["super"] };
    assertEquals(nav.getVisibleFor(user).length, 1);
  });

  await t.step("matches any role in the list", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Ops", href: "/ops", roles: ["admin", "commander"] });
    assertEquals(nav.getVisibleFor({ role: "admin" }).length, 1);
    assertEquals(nav.getVisibleFor({ role: "commander" }).length, 1);
    assertEquals(nav.getVisibleFor({ role: "user" }).length, 0);
  });

  await t.step("sorts items by order", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Z", href: "/z", order: 30 });
    nav.register({ label: "A", href: "/a", order: 10 });
    nav.register({ label: "M", href: "/m", order: 20 });
    const items = nav.getVisibleFor({ role: "user" });
    assertEquals(items[0].label, "A");
    assertEquals(items[1].label, "M");
    assertEquals(items[2].label, "Z");
  });

  await t.step("defaults order to 100 when not set", () => {
    const nav = new NavRegistry();
    nav.register({ label: "First", href: "/first", order: 50 });
    nav.register({ label: "Second", href: "/second" });
    nav.register({ label: "Third", href: "/third", order: 150 });
    const items = nav.getVisibleFor({ role: "user" });
    assertEquals(items[0].label, "First");
    assertEquals(items[1].label, "Second");
    assertEquals(items[2].label, "Third");
  });

  await t.step("items are keyed by href — duplicate href overwrites", () => {
    const nav = new NavRegistry();
    nav.register({ label: "Old", href: "/page" });
    nav.register({ label: "New", href: "/page" });
    const items = nav.getVisibleFor({ role: "user" });
    assertEquals(items.length, 1);
    assertEquals(items[0].label, "New");
  });
});
