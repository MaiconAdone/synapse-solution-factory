import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type NavLinkProps = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export function NavLink({ href, label, icon: Icon }: NavLinkProps) {
  return (
    <Link className="nav-link" href={href}>
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
    </Link>
  );
}
