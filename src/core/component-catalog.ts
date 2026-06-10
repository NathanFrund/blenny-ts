import type { UserInfo } from "./auth.ts";

export interface UIComponent {
  id: string;
  type: string;

  label?: string;
  href?: string;
  icon?: string;
  group?: string;
  order?: number;

  meta?: Record<string, unknown>;

  visible?: (user?: UserInfo) => boolean;
}

export function createComponentCatalog() {
  const items = new Map<string, UIComponent>();

  const register = (component: UIComponent): void => {
    items.set(component.id, { order: 100, ...component });
  };

  const unregister = (id: string): boolean => items.delete(id);

  const getById = (id: string): UIComponent | undefined => items.get(id);

  const isVisible = (
    componentOrId: UIComponent | string,
    user?: UserInfo,
  ): boolean => {
    const c = typeof componentOrId === "string"
      ? items.get(componentOrId)
      : componentOrId;

    if (!c) return false;
    if (!c.visible) return true;

    return c.visible(user);
  };

  const getVisible = (type: string, user?: UserInfo): UIComponent[] => {
    return Array.from(items.values())
      .filter((c) => c.type === type && isVisible(c, user))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  };

  const getNavItems = (user?: UserInfo): UIComponent[] =>
    getVisible("nav", user);

  const getWidgets = (user?: UserInfo): UIComponent[] =>
    getVisible("widget", user);

  const clear = (): void => items.clear();

  return {
    register,
    unregister,
    getById,
    isVisible,
    getVisible,
    getNavItems,
    getWidgets,
    clear,
  };
}

export type ComponentCatalog = ReturnType<typeof createComponentCatalog>;

export const hasRole = (...roles: string[]) =>
  (user?: UserInfo): boolean => {
    if (!user) return false;
    const userRoles = user.roles ?? user.effectiveRoles ??
      (user.role ? [user.role] : []);
    return roles.some((r) => userRoles.includes(r));
  };

export const always = (): boolean => true;
export const never = (): boolean => false;
