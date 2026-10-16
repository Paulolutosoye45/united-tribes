"use client";

import { useState } from "react";

/** Copies the weekly brief as plain text. Nothing is sent anywhere. */
export function CopyBrief({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={copy} className="btn btn-quiet h-10 rounded-full px-5 text-[0.9rem] font-medium">
        Copy as text
      </button>
      <span role="status" className="t-small text-soft">
        {state === "copied" ? "Copied." : state === "failed" ? "Could not copy. Select the text above and copy it by hand." : ""}
      </span>
    </div>
  );
}
