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

export class ComponentRegistry {
  private components = new Map<string, UIComponent>();

  register(component: UIComponent): void {
    this.components.set(component.id, { order: 100, ...component });
  }

  unregister(id: string): boolean {
    return this.components.delete(id);
  }

  getById(id: string): UIComponent | undefined {
    return this.components.get(id);
  }

  getVisible(type: string, user?: UserInfo): UIComponent[] {
    return Array.from(this.components.values())
      .filter((c) => c.type === type && this.isVisible(c, user))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  isVisible(componentOrId: UIComponent | string, user?: UserInfo): boolean {
    const c = typeof componentOrId === "string"
      ? this.components.get(componentOrId)
      : componentOrId;

    if (!c) return false;
    if (!c.visible) return true;

    return c.visible(user);
  }

  getNavItems(user?: UserInfo): UIComponent[] {
    return this.getVisible("nav", user);
  }

  getWidgets(user?: UserInfo): UIComponent[] {
    return this.getVisible("widget", user);
  }

  clear(): void {
    this.components.clear();
  }
}

export const hasRole = (...roles: string[]) =>
  (user?: UserInfo): boolean => {
    if (!user) return false;
    const userRoles = user.roles ?? user.effectiveRoles ?? (user.role ? [user.role] : []);
    return roles.some((r) => userRoles.includes(r));
  };

export const always = (): boolean => true;
export const never = (): boolean => false;
