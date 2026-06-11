import { hasRole } from "./auth.ts";
import type { UserInfo } from "./auth.ts";
import type { FC } from "@hono/hono/jsx";

export interface NavLinkProps {
  href: string;
  label: string;
  icon?: string;
  user?: UserInfo;
  requiredRoles?: string | string[];
  condition?: (user?: UserInfo) => boolean;
  class?: string;
  [key: string]: unknown;
}

export const NavLink: FC<NavLinkProps> = (props) => {
  const {
    href,
    label,
    icon,
    user,
    requiredRoles,
    condition,
    class: className,
    ...rest
  } = props;

  if (requiredRoles) {
    const r = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    if (!hasRole(...r)(user)) return null;
  }

  if (condition && !condition(user)) return null;

  return (
    <a href={href} class={className ?? ""} {...rest}>
      {icon && <span class={icon} />}
      {label}
    </a>
  );
};
