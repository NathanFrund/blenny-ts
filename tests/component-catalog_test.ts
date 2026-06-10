import { assertEquals } from "@std/assert";
import { createComponentCatalog, hasRole, always, never } from "@blenny/core/component-catalog.ts";

Deno.test("ComponentCatalog", async (t) => {
  await t.step("returns nothing when empty", () => {
    const reg = createComponentCatalog();
    assertEquals(reg.getNavItems({ id: "1", role: "user" }), []);
  });

  await t.step("shows item with no visible fn to any user", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.home", type: "nav", label: "Home", href: "/" });
    assertEquals(reg.getNavItems({ id: "1", role: "user" }).length, 1);
    assertEquals(reg.getNavItems(undefined).length, 1);
  });

  await t.step("shows item with matching hasRole", () => {
    const reg = createComponentCatalog();
    reg.register({
      id: "nav.admin",
      type: "nav",
      label: "Admin Panel",
      href: "/admin",
      visible: hasRole("admin"),
    });
    assertEquals(reg.getNavItems({ id: "1", role: "admin" }).length, 1);
  });

  await t.step("hides item with non-matching hasRole", () => {
    const reg = createComponentCatalog();
    reg.register({
      id: "nav.admin",
      type: "nav",
      label: "Admin Panel",
      href: "/admin",
      visible: hasRole("admin"),
    });
    assertEquals(reg.getNavItems({ id: "1", role: "user" }).length, 0);
  });

  await t.step("hides item from anonymous user when role-gated", () => {
    const reg = createComponentCatalog();
    reg.register({
      id: "nav.profile",
      type: "nav",
      label: "Profile",
      href: "/profile",
      visible: hasRole("user"),
    });
    assertEquals(reg.getNavItems(undefined).length, 0);
  });

  await t.step("shows item when multiple roles and one matches", () => {
    const reg = createComponentCatalog();
    reg.register({
      id: "nav.ops",
      type: "nav",
      label: "Ops",
      href: "/ops",
      visible: hasRole("admin", "commander"),
    });
    assertEquals(reg.getNavItems({ id: "1", role: "admin" }).length, 1);
    assertEquals(reg.getNavItems({ id: "1", role: "commander" }).length, 1);
    assertEquals(reg.getNavItems({ id: "1", role: "user" }).length, 0);
  });

  await t.step("hasRole uses roles array when present", () => {
    const reg = createComponentCatalog();
    reg.register({
      id: "nav.commander",
      type: "nav",
      label: "Commander View",
      href: "/command",
      visible: hasRole("commander"),
    });
    const user = { id: "1", role: "user", roles: ["commander"] };
    assertEquals(reg.getNavItems(user).length, 1);
  });

  await t.step("hasRole checks roles array first, then effectiveRoles, then role", () => {
    const vis = hasRole("commander");
    assertEquals(vis({ id: "1", role: "user", roles: ["commander"] }), true);
    assertEquals(vis({ id: "1", role: "user", effectiveRoles: ["commander"] }), true);
    assertEquals(vis({ id: "1", role: "commander" }), true);
    assertEquals(vis({ id: "1", role: "user" }), false);
    assertEquals(vis(undefined), false);
  });

  await t.step("sorts items by order", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.z", type: "nav", label: "Z", href: "/z", order: 30 });
    reg.register({ id: "nav.a", type: "nav", label: "A", href: "/a", order: 10 });
    reg.register({ id: "nav.m", type: "nav", label: "M", href: "/m", order: 20 });
    const items = reg.getNavItems({ id: "1", role: "user" });
    assertEquals(items[0].label, "A");
    assertEquals(items[1].label, "M");
    assertEquals(items[2].label, "Z");
  });

  await t.step("defaults order to 100 when not set", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.first", type: "nav", label: "First", href: "/first", order: 50 });
    reg.register({ id: "nav.second", type: "nav", label: "Second", href: "/second" });
    reg.register({ id: "nav.third", type: "nav", label: "Third", href: "/third", order: 150 });
    const items = reg.getNavItems({ id: "1", role: "user" });
    assertEquals(items[0].label, "First");
    assertEquals(items[1].label, "Second");
    assertEquals(items[2].label, "Third");
  });

  await t.step("items are keyed by id — duplicate id overwrites", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.page", type: "nav", label: "Old", href: "/page" });
    reg.register({ id: "nav.page", type: "nav", label: "New", href: "/page" });
    const items = reg.getNavItems({ id: "1", role: "user" });
    assertEquals(items.length, 1);
    assertEquals(items[0].label, "New");
  });

  await t.step("getVisible respects component type", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.home", type: "nav", label: "Home", href: "/" });
    reg.register({ id: "widget.stats", type: "widget", label: "Stats", meta: {} });
    assertEquals(reg.getVisible("nav", { id: "1", role: "user" }).length, 1);
    assertEquals(reg.getVisible("widget", { id: "1", role: "user" }).length, 1);
    assertEquals(reg.getVisible("panel", { id: "1", role: "user" }).length, 0);
  });

  await t.step("getWidgets returns only widget type", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "widget.a", type: "widget", label: "A" });
    reg.register({ id: "nav.b", type: "nav", label: "B", href: "/b" });
    const widgets = reg.getWidgets({ id: "1", role: "user" });
    assertEquals(widgets.length, 1);
    assertEquals(widgets[0].id, "widget.a");
  });

  await t.step("isVisible with id string", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.home", type: "nav", label: "Home", href: "/" });
    assertEquals(reg.isVisible("nav.home", { id: "1", role: "user" }), true);
    assertEquals(reg.isVisible("nonexistent", { id: "1", role: "user" }), false);
  });

  await t.step("isVisible with component object", () => {
    const reg = createComponentCatalog();
    const c = { id: "test", type: "nav", label: "Test", href: "/test" };
    assertEquals(reg.isVisible(c, { id: "1", role: "user" }), true);
  });

  await t.step("getById returns the correct component", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.home", type: "nav", label: "Home", href: "/" });
    const c = reg.getById("nav.home");
    assertEquals(c?.label, "Home");
    assertEquals(reg.getById("missing"), undefined);
  });

  await t.step("clear removes all components", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.a", type: "nav", label: "A", href: "/a" });
    reg.register({ id: "nav.b", type: "nav", label: "B", href: "/b" });
    reg.clear();
    assertEquals(reg.getNavItems({ id: "1", role: "user" }).length, 0);
  });

  await t.step("custom visible callback overrides role check", () => {
    const reg = createComponentCatalog();
    reg.register({
      id: "nav.custom",
      type: "nav",
      label: "Custom",
      href: "/custom",
      visible: () => false,
    });
    assertEquals(reg.getNavItems({ id: "1", role: "admin" }).length, 0);
  });

  await t.step("always returns true", () => {
    assertEquals(always(), true);
  });

  await t.step("never returns false", () => {
    assertEquals(never(), false);
  });

  await t.step("unregister removes a component", () => {
    const reg = createComponentCatalog();
    reg.register({ id: "nav.x", type: "nav", label: "X", href: "/x" });
    assertEquals(reg.getNavItems({ id: "1", role: "user" }).length, 1);
    assertEquals(reg.unregister("nav.x"), true);
    assertEquals(reg.getNavItems({ id: "1", role: "user" }).length, 0);
    assertEquals(reg.unregister("nonexistent"), false);
  });
});
