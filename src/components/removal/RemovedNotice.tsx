"use client";

import Link from "next/link";
import { useState } from "react";
import { appealRemovalAction } from "@/app/(app)/home/removal-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button, buttonClasses } from "@/components/ui/Button";
import { formatDate } from "@/lib/dates";
import { REMOVAL_WORDS, type MyRemoval } from "@/lib/removal/removal";

/**
 * What a member reads when the church has changed their place in a tribe: said kindly, with the other tribes, a named person to speak to, and for 14 days
 * a way to ask that person to look at it again. It never says who asked or why. Shown on Home for 30 days; nothing while the switch is Off, and never to a
 * young person (the Care Lead speaks to their parent or guardian).
 */
export function RemovedNotice({ removal: r }: { removal: MyRemoval }) {
  const d = useDo();
  const [note, setNote] = useState("");

  if (r.reinstated) {
    return (
      <section aria-labelledby="removed-h" className="card flex flex-col gap-2 p-5 sm:p-6" data-testid="removed-notice">
        <h2 id="removed-h" className="t-heading">
          {REMOVAL_WORDS.memberBack(r.tribe)}
        </h2>
        <div>
          <Link href="/tribe" className={buttonClasses({ size: "md" })}>
            <span className="relative">Open my tribe</span>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="removed-h" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="removed-notice">
      <div className="flex flex-col gap-1.5">
        <h2 id="removed-h" className="t-heading">
          {REMOVAL_WORDS.memberTitle(r.tribe)}
        </h2>
        <p className="t-body measure text-soft">{REMOVAL_WORDS.memberBody}</p>
        <p className="t-small measure text-soft">{REMOVAL_WORDS.memberSpeak(r.contact_first)}</p>
      </div>

      <div>
        <Link href="/tribe" className={buttonClasses({ size: "md" })} data-testid="removed-see-tribes">
          <span className="relative">{REMOVAL_WORDS.memberSeeTribes}</span>
        </Link>
      </div>

      {r.appeal ? (
        <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="removed-appeal-state">
          {r.appeal.status === "open" ? REMOVAL_WORDS.memberAppealWaiting : r.appeal.status === "upheld" ? REMOVAL_WORDS.memberAppealUpheld : REMOVAL_WORDS.memberBack(r.tribe)}
        </p>
      ) : null}

      {r.can_appeal ? (
        <form
          className="flex flex-col gap-3"
          data-testid="removed-appeal"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("appeal", () => appealRemovalAction(r.id, note), { saved: REMOVAL_WORDS.memberAppealSent, after: () => setNote("") });
          }}
        >
          <p className="t-small measure text-soft">{REMOVAL_WORDS.memberAppealIntro(r.contact_first, r.appeal_until ? formatDate(r.appeal_until) : "the end of two weeks")}</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">{REMOVAL_WORDS.memberAppealLabel}</span>
            <textarea className="input min-h-24 py-3" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Notice error={d.error} saved={d.saved} />
          <div>
            <Button type="submit" size="md" variant="quiet" loading={d.busy === "appeal"}>
              {REMOVAL_WORDS.memberAppealSubmit}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
