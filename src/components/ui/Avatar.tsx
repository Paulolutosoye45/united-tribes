"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

const RING = "shadow-[inset_0_0_0_1.5px_rgb(244_196_67/0.55)]";

/**
 * A round badge with the person's initials, or their portrait when they have added one. The picture comes
 * from /api/photo/<person id>, which only answers people allowed to see it; where it cannot (or the picture
 * fails to load), the initials show instead.
 */
export function Avatar({
  name,
  size = 40,
  className,
  photoId,
  version,
}: {
  name: string;
  size?: number;
  className?: string;
  /** The person whose portrait to show. Leave out for initials only. */
  photoId?: string | null;
  /** Changes when the picture changes, so the browser fetches the new one. */
  version?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (photoId && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already small
      <img
        src={`/api/photo/${photoId}${version ? `?v=${encodeURIComponent(version)}` : ""}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        data-testid="avatar-photo"
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className={cn("inline-block shrink-0 rounded-full bg-charcoal object-cover ring-2 ring-gold/60", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-gold",
        "bg-[radial-gradient(120%_120%_at_20%_0%,#4a4a45,var(--crest-charcoal))]",
        RING,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export { initials };
