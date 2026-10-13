"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { forwardTestimonyAction } from "@/app/(app)/rhythm/actions";
import { Button } from "@/components/ui/Button";
import type { ForwardedTestimony } from "@/lib/rhythm/types";

/**
 * For the pastorate: records that a testimony went to the TCN testimony form and shows the words to paste
 * there. The form itself is TCN's own, so we do not post to it; we keep the record of who sent what, and when.
 */
export function ForwardTestimony({ id, forwarded, formUrl }: { id: string; forwarded: boolean; formUrl: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ForwardedTestimony | null>(null);
  const [copied, setCopied] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    const result = await forwardTestimonyAction(id);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSent(result.testimony);
    router.refresh();
  }

  const paste = sent ? `${sent.body}\n\n– ${sent.by}${sent.community ? `, ${sent.community}` : ""}` : "";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="sm" variant={forwarded && !sent ? "ghost" : "quiet"} loading={busy} onClick={() => void go()}>
          {sent || forwarded ? "Show the words again" : "Send to the TCN form"}
        </Button>
        {forwarded || sent ? <span className="t-small text-soft">Recorded as sent</span> : null}
      </div>
      {sent ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line bg-surface-strong p-4">
          <p className="t-small text-soft">Paste this into the testimony form{formUrl ? "" : " (ask the media team for its address)"}.</p>
          <p className="t-body whitespace-pre-line">{paste}</p>
          <div className="flex flex-wrap gap-2.5">
            <Button
              size="sm"
              variant="solid"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(paste);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy the words"}
            </Button>
            {formUrl ? (
              <a href={formUrl} target="_blank" rel="noopener noreferrer" className="btn btn-quiet inline-flex h-10 items-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium">
                Open the form
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
