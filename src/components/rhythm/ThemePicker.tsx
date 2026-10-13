"use client";

import { Chip } from "@/components/ui/Chip";
import { TESTIMONY_THEMES, type TestimonyTheme } from "@/lib/rhythm/types";
import { THEME_NAMES } from "@/lib/rhythm/wording";

/** Up to three themes for a testimony, so it can be found on the wall later. */
export function ThemePicker({ value, onChange, label = "What is it about? Choose up to three." }: { value: TestimonyTheme[]; onChange: (next: TestimonyTheme[]) => void; label?: string }) {
  function toggle(t: TestimonyTheme) {
    if (value.includes(t)) return onChange(value.filter((x) => x !== t));
    if (value.length >= 3) return;
    onChange([...value, t]);
  }
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <p className="t-small text-soft">{label}</p>
      <div className="flex flex-wrap gap-2">
        {TESTIMONY_THEMES.map((t) => (
          <Chip key={t} selected={value.includes(t)} onClick={() => toggle(t)} disabled={!value.includes(t) && value.length >= 3} className="min-h-10 px-3.5 text-[0.88rem] disabled:opacity-40">
            {THEME_NAMES[t]}
          </Chip>
        ))}
      </div>
    </div>
  );
}
