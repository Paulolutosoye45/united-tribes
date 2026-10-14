"use client";

import { useState } from "react";
import { openChatAction } from "@/lib/outreach/chat-actions";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";

/**
 * “Message on WhatsApp”: opens the person’s own WhatsApp with a kind first line ready. We cannot see whether it was sent.
 * Only shown for people who said yes to WhatsApp, and only to their contact.
 */
export function ChatButton({ person, context, name }: { person: string; context: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    // Open the tab now, from the tap, so the browser allows it; point it at the chat once we have the number.
    const tab = window.open("", "_blank");
    try {
      const done = await openChatAction(person, context);
      if (!done.ok) {
        tab?.close();
        setProblem(done.message);
        return;
      }
      const digits = done.data.phone.replace(/[^\d]/g, "");
      const url = `https://wa.me/${digits}${done.data.text ? `?text=${encodeURIComponent(done.data.text)}` : ""}`;
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      tab?.close();
      setProblem("We couldn’t open WhatsApp. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        aria-label={`Message ${name} on WhatsApp`}
        className="press inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-line bg-raised px-4 text-[0.9rem] font-semibold hover:border-soft disabled:opacity-60"
      >
        <WhatsAppIcon size={16} />
        Message on WhatsApp
      </button>
      {problem ? (
        <span role="alert" className="t-small text-danger">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
