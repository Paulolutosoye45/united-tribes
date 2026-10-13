"use client";

import { ShieldProgress } from "@/components/brand/ShieldProgress";

const BURST = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + (i % 2) * 0.2;
  const dist = 120 + ((i * 37) % 90);
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist) - 20,
    rot: (i * 53) % 360,
    d: (i % 6) * 40,
    color: ["#f4c443", "#e86838", "#e89838", "#ffffff"][i % 4],
    w: 6 + (i % 3) * 3,
  };
});

/** The completed shield with a short burst of confetti. Shown once, when a form is sent. */
export function ShieldBurst({ label }: { label: string }) {
  return (
    <div className="relative grid place-items-center">
      <div
        aria-hidden="true"
        className="glow-breathe absolute h-64 w-64 rounded-full bg-[radial-gradient(tribe,rgb(244_196_67/0.45),transparent_68%)] blur-xl"
      />
      <div aria-hidden="true" className="burst pointer-events-none absolute left-1/2 top-1/2">
        {BURST.map((b, i) => (
          <span
            key={i}
            className="absolute rounded-[2px] opacity-0"
            style={{
              width: b.w,
              height: b.w * 1.6,
              background: b.color,
              ["--dx" as string]: `${b.dx}px`,
              ["--dy" as string]: `${b.dy}px`,
              ["--rot" as string]: `${b.rot}deg`,
              ["--d" as string]: b.d,
            }}
          />
        ))}
      </div>
      <div className="pop-in relative">
        <ShieldProgress fills={[1, 1, 1, 1]} size={132} tone="light" label={label} done />
      </div>
    </div>
  );
}
