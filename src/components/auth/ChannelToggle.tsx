"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { SignInTab } from "@/lib/signin/choice";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";

type Props = {
  value: SignInTab;
  onChange: (tab: SignInTab) => void;
  /** WhatsApp is switched off or paused: it stays visible but greyed, and cannot be chosen. Email never can be. */
  whatsappDisabled: boolean;
  /** The id of the panel the tabs control */
  panelId: string;
};

const TABS: { id: SignInTab; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
];

/**
 * Email | WhatsApp, as two tabs. Each is at least 48px tall, the arrow keys move between them, and a screen reader
 * hears "WhatsApp, tab, dimmed" when it is paused (it stays focusable so the reason, shown beside it, can be found).
 */
export function ChannelToggle({ value, onChange, whatsappDisabled, panelId }: Props) {
  const refs = useRef<Record<SignInTab, HTMLButtonElement | null>>({ email: null, whatsapp: null });

  function move(to: SignInTab) {
    if (to === "whatsapp" && whatsappDisabled) return;
    onChange(to);
    refs.current[to]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") move("whatsapp");
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move("email");
    else if (event.key === "Home") move("email");
    else if (event.key === "End") move("whatsapp");
    else return;
    event.preventDefault();
  }

  return (
    <div role="tablist" aria-label="How to get your code" className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-surface p-1">
      {TABS.map((tab) => {
        const selected = value === tab.id;
        const dimmed = tab.id === "whatsapp" && whatsappDisabled;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`signin-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            aria-disabled={dimmed || undefined}
            tabIndex={selected ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => {
              if (!dimmed) onChange(tab.id);
            }}
            className={cn(
              "inline-flex h-12 min-w-0 items-center justify-center gap-2 rounded-[calc(var(--radius-control)-4px)] px-3 text-[0.95rem] font-medium transition-[background-color,box-shadow,color] duration-200",
              selected ? "bg-raised font-semibold text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]" : "text-soft hover:text-ink",
              dimmed && "cursor-not-allowed opacity-50 hover:text-soft",
            )}
          >
            {tab.id === "whatsapp" ? <WhatsAppIcon size={18} /> : null}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
