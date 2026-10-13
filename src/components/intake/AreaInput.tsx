"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { areaBySlug, matchAreas, type Area } from "@/lib/intake/areas";
import { ZONES } from "@/lib/intake/options";

const zoneLabel = (zone: string) => ZONES.find((z) => z.id === zone)?.label ?? zone;

/**
 * Type where you live and pick it from the list: the zone follows on its own. Built as a combobox so it works with a
 * keyboard and a screen reader (arrow keys move, Enter picks, Escape closes). Nothing is sent anywhere: the list is
 * in the page. A place that isn't listed can simply be typed, and the person chooses the nearest zone below.
 */
export function AreaInput({
  value,
  slug,
  abroad,
  onType,
  onPick,
}: {
  value: string;
  slug: string | undefined;
  abroad: boolean;
  onType: (text: string) => void;
  onPick: (area: Area) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const picked = areaBySlug(slug);
  const matches = useMemo(() => (picked && picked.name === value ? [] : matchAreas(value)), [value, picked]);
  const showing = open && matches.length > 0;

  function choose(area: Area) {
    onPick(area);
    setOpen(false);
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-[0.95rem] font-medium">
        <span>{abroad ? "Which country?" : "Which area do you live in?"}</span>
        <span className="t-small font-normal text-soft">Optional</span>
      </label>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        autoCapitalize="words"
        maxLength={80}
        placeholder={abroad ? "e.g. United Kingdom" : "e.g. Yaba, Sangotedo, Surulere"}
        value={value}
        onChange={(e) => {
          onType(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cn(
          "h-14 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base text-ink transition-[border-color,box-shadow] duration-200 hover:border-soft",
          "placeholder:text-soft/70 focus:border-ink focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)] focus:outline-none",
        )}
      />
      {showing ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Places that match"
          className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto p-1.5 shadow-lg"
        >
          {matches.map((area, i) => (
            <li
              key={area.slug}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(area);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2",
                i === active ? "bg-gold/30" : "hover:bg-gold/15",
              )}
            >
              <span className="font-medium">{area.name}</span>
              <span className="t-small text-soft">{zoneLabel(area.zone)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {picked && picked.name === value ? (
        <p className="t-small text-success" role="status">
          {zoneLabel(picked.zone)}. Not right? Choose another zone below.
        </p>
      ) : null}
    </div>
  );
}
