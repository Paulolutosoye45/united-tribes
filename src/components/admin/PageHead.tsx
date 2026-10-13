import Link from "next/link";
import type { ReactNode } from "react";

/** The top of every office screen: a way back to the Admin hub, the title and what the screen is for. */
export function PageHead({ title, children, back = { href: "/admin", label: "Admin" } }: { title: string; children?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="flex flex-col gap-2">
      <Link href={back.href} className="t-small text-soft hover:text-ink">
        <span aria-hidden="true">← </span>
        {back.label}
      </Link>
      <h1 className="t-title">{title}</h1>
      {children ? <div className="t-body measure text-soft">{children}</div> : null}
    </header>
  );
}
