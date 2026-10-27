"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { helpFor, type HelpEntry } from "@/lib/guides/context";
import { IconHelp } from "./icons";

/** A small round "?" in the header, on the pages that have a guide. It names the guide when you hold your pointer on it. */
export function HelpLink({ entries }: { entries: HelpEntry[] }) {
  const pathname = usePathname();
  const entry = helpFor(entries, pathname);
  if (!entry) return null;
  return (
    <Link
      href={`/guides/${entry.slug}`}
      title={`How-to guide: ${entry.title}`}
      className="press grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-raised text-soft transition-colors hover:text-ink"
    >
      <IconHelp />
      <span className="sr-only">Help for this page</span>
    </Link>
  );
}
