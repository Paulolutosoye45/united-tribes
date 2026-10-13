"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Keeps the page it sits on up to date: every few seconds, while the tab is showing, it asks the server for the page
 * again. A switch turns it off. There is no second data path: the page is the same page, drawn again.
 */
export function LiveRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, seconds * 1000);
    return () => window.clearInterval(id);
  }, [live, seconds, router]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      onClick={() => setLive((l) => !l)}
      className="press inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[0.85rem] font-medium text-soft hover:text-ink"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-[var(--crest-gold)]" : "bg-line"}`} />
      {live ? "Live" : "Paused"}
    </button>
  );
}
