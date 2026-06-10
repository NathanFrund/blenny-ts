import type { UserInfo } from "./auth.ts";
import type { FC } from "@hono/hono/jsx";

export const hasRole = (...roles: string[]) => (user?: UserInfo): boolean => {
  if (!user) return false;

  const userRoles = [
    ...(user.roles ?? []),
    ...(user.effectiveRoles ?? []),
    ...(user.role ? [user.role] : []),
  ];

  return roles.some((r) => userRoles.includes(r));
};

export interface NavLinkProps {
  href: string;
  label: string;
  icon?: string;
  user?: UserInfo;
  requiredRoles?: string | string[];
  condition?: (user?: UserInfo) => boolean;
}

export const NavLink: FC<NavLinkProps> = (
  { href, label, icon, user, requiredRoles, condition },
) => {
  if (requiredRoles) {
    const r = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    if (!hasRole(...r)(user)) return null;
  }

  if (condition && !condition(user)) return null;

  return (
    <p>
      <a href={href}>
        {icon && <span class={icon} />}
        {label}
      </a>
    </p>
  );
};
