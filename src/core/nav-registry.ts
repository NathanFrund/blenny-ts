export interface NavItem {
  label: string;
  href: string;
  roles?: string[];
  group?: "main" | "account" | "admin";
  order?: number;
}

export class NavRegistry {
  private items = new Map<string, NavItem>();

  register(item: NavItem): void {
    this.items.set(item.href, { order: 100, ...item });
  }

  getVisibleFor(user?: { role: string }): NavItem[] {
    return Array.from(this.items.values())
      .filter((n) => isVisible(n, user))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
}

function isVisible(item: NavItem, user?: { role: string }): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  if (!user) return false;
  return item.roles.includes(user.role);
}
