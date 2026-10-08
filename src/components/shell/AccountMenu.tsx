"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { signOut } from "@/app/(app)/actions";

type Props = {
  name: string;
  email: string;
  roleLabel: string;
};

export function AccountMenu({ name, email, roleLabel }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Your account"
        onClick={() => setOpen((o) => !o)}
        className="press rounded-full ring-offset-2 ring-offset-page transition-shadow hover:ring-2 hover:ring-gold/70"
      >
        <Avatar name={name} size={42} />
      </button>

      {open ? (
        <div
          role="region"
          aria-label="Account"
          className="pop-in absolute right-0 top-[calc(100%+10px)] z-40 w-[min(18rem,calc(100vw-2.5rem))] origin-top-right rounded-3xl border border-line bg-raised p-4 shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-center gap-3">
            <Avatar name={name} size={44} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              <p className="t-small truncate text-soft">{email}</p>
            </div>
          </div>
          <div className="mt-3">
            <Badge tone="gold">{roleLabel}</Badge>
          </div>
          <div className="mt-4 border-t border-line pt-2">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="press flex h-12 items-center rounded-[var(--radius-control)] px-3 font-medium hover:bg-surface"
            >
              Privacy and my data
            </Link>
          </div>
          <form action={signOut} className="border-t border-line pt-2 mt-2">
            <button
              type="submit"
              className="press h-12 w-full rounded-[var(--radius-control)] text-left font-medium hover:bg-surface"
            >
              <span className="px-3">Sign out</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
