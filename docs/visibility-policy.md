# Visibility Policy

> **Status: Superseded** — the JSX-first approach (NavLink + hasRole) was chosen instead.
> See `src/core/nav.tsx` and "Navigation & Visibility" in `docs/modules.md`.
> This document is kept for historical context on the design exploration.

A thin, composable scaffold for deciding whether a component should render.

## Problem: Scope drift in `component-catalog.ts`

The current module mixes four distinct concerns:

| Concern | Responsibility | API surface |
|---|---|---|
| **Registry** | Storing/fetching components by ID | `register`, `unregister`, `getById`, `clear` |
| **Type query** | Filtering by component category | `getVisible(type)`, `getNavItems()`, `getWidgets()` |
| **Visibility** | Deciding whether to render | `visible` callback on `UIComponent`, `isVisible()`, `hasRole()` |
| **Metadata** | Display-oriented data shape | `label`, `href`, `icon`, `group`, `order`, `meta` |

The original idea was: register a component once with a `visible` callback, then query it later and trust the callback. But this design has several limitations:

1. **One callback per component, set at registration time.** You can't apply different filters in different contexts (admin panel vs. user-facing, A/B test variant, feature-flag toggled at runtime).

2. **The callback can't see the component's own metadata.** `visible` receives only `UserInfo`, so you can't write `(user) => user.hasFeature(component.meta.featureFlag)` — the component is invisible to its own predicate.

3. **No composition.** `hasRole("admin")` and `hasRole("user")` can't be combined — there's no `and()`, `or()`, or `not()`.

4. **The type-query helpers (`getNavItems`, `getWidgets`) are sugar baked into the registry**, making the registry harder to reuse for non-nav purposes.

## Proposal

Separate the concerns cleanly:

### 1. Registry — just a map

Stripped of visibility logic. A place to put and retrieve components.

```ts
// component-catalog.ts — slimmed down
export interface UIComponent {
  id: string;
  type: string;
  label?: string;
  href?: string;
  icon?: string;
  group?: string;
  order?: number;
  meta?: Record<string, unknown>;
}

export function createComponentCatalog() {
  const items = new Map<string, UIComponent>();

  const register = (c: UIComponent) => { items.set(c.id, { order: 100, ...c }); };
  const unregister = (id: string) => items.delete(id);
  const getById = (id: string) => items.get(id);
  const getByType = (type: string) =>
    Array.from(items.values())
      .filter((c) => c.type === type)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const clear = () => items.clear();

  return { register, unregister, getById, getByType, clear };
}
```

`visible`, `isVisible`, `hasRole`, `always`, `never`, `getNavItems`, `getWidgets` are removed.

### 2. Visibility Policy — the thin scaffold

A policy is a function that receives the component and the user, and returns `true`/`false`:

```ts
type VisibilityPolicy = (component: UIComponent, user?: UserInfo) => boolean;
```

The component is passed in so the policy can inspect its metadata — this is the key insight that the current design misses.

### 3. Composables

```ts
// Composes multiple policies
const and = (...policies: VisibilityPolicy[]): VisibilityPolicy =>
  (c, user) => policies.every((p) => p(c, user));

const or = (...policies: VisibilityPolicy[]): VisibilityPolicy =>
  (c, user) => policies.some((p) => p(c, user));

const not = (policy: VisibilityPolicy): VisibilityPolicy =>
  (c, user) => !policy(c, user);
```

### 4. Built-in policies

```ts
// Role check — same logic as current hasRole, but receives component too
const hasRole = (...roles: string[]): VisibilityPolicy =>
  (_, user) => {
    if (!user) return false;
    const userRoles = user.roles ?? user.effectiveRoles ?? (user.role ? [user.role] : []);
    return roles.some((r) => userRoles.includes(r));
  };

// Metadata-driven — the policy inspects the component's own data
const hasMeta = (key: string, value: unknown): VisibilityPolicy =>
  (component) => component.meta?.[key] === value;

const always: VisibilityPolicy = () => true;
const never: VisibilityPolicy = () => false;
```

### 5. Bridge — apply policy to registry data

A simple utility that connects registry output to a policy:

```ts
const filter = (
  components: UIComponent[],
  policy: VisibilityPolicy,
  user?: UserInfo,
): UIComponent[] => components.filter((c) => policy(c, user));
```

## How the calling code changes

### Registration — no `visible` callback

```ts
// Before
state.components.register({
  id: "nav.admin",
  type: "nav",
  label: "Admin",
  href: "/admin",
  visible: hasRole("admin"),
});

// After — just data
state.components.register({
  id: "nav.admin",
  type: "nav",
  label: "Admin",
  href: "/admin",
  meta: { requiredRole: "admin" },
});
```

### Handler — policy applied at query time

```ts
// Before
const navItems = components.getNavItems(user);

// After
const navItems = filter(
  components.getByType("nav"),
  hasRole("admin"),
  user,
);
```

Or with a metadata-driven policy:

```ts
const navItems = filter(
  components.getByType("nav"),
  and(hasRole("user"), hasMeta("feature", "beta")),
  user,
);
```

### Different contexts, different policies

The same registry can be queried with different policies in different handlers:

```ts
// Public API — only show items with no role requirement
filter(components.getByType("nav"), not(hasRole("admin")), user);

// Audit panel — show everything
filter(components.getByType("nav"), always, user);

// User profile — merge nav + profile items
filter(components.getByType("nav"), hasRole("user"), user);
```

## What this buys you

| Property | Before | After |
|---|---|---|
| Policy knows the component | No (`visible(user)`) | Yes (`policy(component, user)`) |
| Multiple policies per component | No (one callback) | Yes (and/or/not composition) |
| Runtime policy swap | No (baked at registration) | Yes (passed at query time) |
| Policies testable in isolation | Indirectly (via registry) | Directly (pure functions) |
| Registry usable without visibility logic | No | Yes |
| Type-query methods hardcoded | `getNavItems`, `getWidgets` | Generic `getByType` + `filter` |

## Path

### Phase 1 — extract the policy module

Create `src/core/visibility-policy.ts` with `VisibilityPolicy`, `and`, `or`, `not`, `hasRole`, `hasMeta`, `always`, `never`, `filter`. No changes to any other file. This is additive.

### Phase 2 — simplify the registry

Remove `visible`, `isVisible`, `getNavItems`, `getWidgets`, `hasRole`, `always`, `never` from `component-catalog.ts`. Add `getByType`. Update callers. Update imports.

### Phase 3 — migrate callers

Each module that calls `components.getNavItems(user)` becomes:
```ts
filter(components.getByType("nav"), myPolicy, user)
```

## Open questions

1. **Keep `getNavItems`/`getWidgets` as sugar on top of the policy module?** E.g. `getNavItems(catalog, policy, user)` — a free function rather than a method on the registry.

2. **Does the registry need `getByType` at all?** Could callers iterate `getById` and filter themselves. But `getByType` is the common case and avoids scattering sort logic.

3. **Should the policy module also own sorting?** Or is that purely a registry concern? Currently sorting is hardcoded in `getVisible`/`getNavItems`. If a caller wants a different sort order, they're stuck.

4. **Does `AppState` need `components` at all** after the split? The registry is just a map. Modules could maintain their own component lists. But a shared registry enables cross-module nav merging (dashboard registers `nav.dashboard`, user-admin registers `nav.user-admin`, both appear in the same nav list).

5. **Error-handling policies?** Should a policy that throws be caught gracefully (treat as `false`), or should it propagate?
