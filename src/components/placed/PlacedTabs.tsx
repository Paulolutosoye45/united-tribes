import Link from "next/link";
import { BOARD_WORDS } from "@/lib/placement/answers";

/** The three views of the Placed members area. The call desk is shown to the people who may use it only. */
export function PlacedTabs({ current, canDesk }: { current: "board" | "tribes" | "desk"; canDesk: boolean }) {
  const tabs = [
    { key: "board" as const, href: "/admin/placed", label: BOARD_WORDS.tabs.board },
    { key: "tribes" as const, href: "/admin/placed/tribes", label: BOARD_WORDS.tabs.tribes },
    ...(canDesk ? [{ key: "desk" as const, href: "/admin/placed/desk", label: BOARD_WORDS.tabs.desk }] : []),
  ];
  return (
    <nav aria-label="Placed members" className="flex flex-wrap gap-2" data-testid="placed-tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full border px-5 text-[0.95rem] font-medium ${t.key === current ? "border-ink bg-ink text-page" : "border-line bg-raised hover:border-soft"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
