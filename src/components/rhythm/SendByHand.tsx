"use client";

import Link from "next/link";
import { useState } from "react";
import { markHandAction, openGroupAction, openMemberChatAction } from "@/app/(app)/lead/hand/actions";
import { useDo } from "@/components/admin/useDo";
import { Notice } from "@/components/admin/Notice";
import { Button, buttonClasses } from "@/components/ui/Button";
import { whenText } from "@/lib/signin/admin";
import { groupText, personText, withFirst, type HandWeek } from "@/lib/whatsapp/hand-text";
import { GROUP_KINDS, PERSON_KINDS, type GroupKind, type HandContext, type PersonKind } from "@/lib/whatsapp/mode-view";

const field = "w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 py-2 text-base focus:border-ink focus:outline-none";
const KIND_WORDS: Record<string, string> = {
  week_start: "the week's passage and step",
  meeting_reminder: "a meeting reminder",
  meeting_recap: "a thank-you after the meeting",
  custom: "a message to the group",
  welcome: "a welcome",
  missed_two: "a check-in after two missed weeks",
  step: "a question about their step",
  thanks: "a thank-you",
  other: "a message",
};

/** WhatsApp sent by a person: this week's words for the tribe's group, and a message to each member who said yes to WhatsApp. Nothing is sent from here; WhatsApp opens on the leader's own phone. */
export function SendByHand({ ctx, week }: { ctx: HandContext; week: HandWeek }) {
  const d = useDo();
  const [gKind, setGKind] = useState<GroupKind>("week_start");
  const [gText, setGText] = useState(() => groupText("week_start", week));
  const [pKind, setPKind] = useState<PersonKind>("welcome");
  const [pText, setPText] = useState(() => personText("welcome", week));
  const [open, setOpen] = useState<{ key: string; log: number; link: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const chooseGroup = (k: GroupKind) => {
    setGKind(k);
    setGText(groupText(k, week));
  };
  const choosePerson = (k: PersonKind) => {
    setPKind(k);
    setPText(personText(k, week));
  };
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  const reachable = ctx.members.filter((m) => m.wa && m.open);

  return (
    <div className="flex flex-col gap-8" data-testid="send-by-hand">
      {ctx.free ? (
        <section className="card flex flex-col gap-2 p-5 sm:p-6" data-testid="hand-free">
          <h2 className="t-heading">The church is not sending WhatsApp from the site</h2>
          <p className="t-small">Your members get their weekly messages by email instead. WhatsApp from you is how they hear from you personally, so the tools below matter more than usual.</p>
          {ctx.unsent.length > 0 ? (
            <p className="t-small" data-testid="hand-unsent">
              These members could not be reached by email either, so please message them yourself: <strong>{ctx.unsent.join(", ")}</strong>.
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="hand-group" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="hand-group">
        <h2 id="hand-group" className="t-heading">
          Post to your tribe&rsquo;s group
        </h2>
        {ctx.tribe.groupUrl ? (
          <>
            <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
              What to post
              <select value={gKind} onChange={(e) => chooseGroup(e.target.value as GroupKind)} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base" data-testid="hand-group-kind">
                {GROUP_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
              The words (change them as you like)
              <textarea value={gText} onChange={(e) => setGText(e.target.value)} rows={5} maxLength={1500} className={field} data-testid="hand-group-text" />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button variant="solid" size="md" data-testid="hand-group-copy" disabled={!gText.trim()} onClick={() => void copy(gText)}>
                {copied ? "Copied" : "Copy the words"}
              </Button>
              <Button
                variant="ghost"
                size="md"
                data-testid="hand-group-open"
                loading={d.busy === "group"}
                onClick={() =>
                  void (async () => {
                    await copy(gText);
                    await d.go("group", async () => {
                      const r = await openGroupAction(ctx.tribe.id, gKind);
                      if (!r.ok) return r;
                      if (r.data.groupUrl) {
                        setOpen({ key: "group", log: r.data.log, link: r.data.groupUrl, label: "your tribe's group" });
                        window.open(r.data.groupUrl, "_blank", "noopener,noreferrer");
                      }
                      return { ok: true };
                    });
                  })()
                }
              >
                Copy and open the group
              </Button>
            </div>
            <p className="t-small text-soft">WhatsApp opens on your phone. Paste the words and press send; nothing is sent from this website.</p>
          </>
        ) : (
          <p className="t-small" data-testid="hand-group-none">
            Your tribe has no WhatsApp group link saved yet. Add it on{" "}
            <Link href="/lead/tribe" className="underline">
              your Tribe page
            </Link>
            , and this section will give you the words to post.
          </p>
        )}
        {open?.key === "group" ? <Opened open={open} d={d} close={() => setOpen(null)} /> : null}
      </section>

      <section aria-labelledby="hand-members" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="hand-members">
        <h2 id="hand-members" className="t-heading">
          Message someone yourself
        </h2>
        <p className="t-small text-soft">Only members who said yes to WhatsApp, and whose details are open to you, can be messaged from here. You never see a number on this page; WhatsApp opens on your phone with the words ready.</p>
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          What to say
          <select value={pKind} onChange={(e) => choosePerson(e.target.value as PersonKind)} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base" data-testid="hand-person-kind">
            {PERSON_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          The words ([first] becomes each person&rsquo;s first name)
          <textarea value={pText} onChange={(e) => setPText(e.target.value)} rows={3} maxLength={1000} className={field} data-testid="hand-person-text" />
        </label>
        {ctx.members.length === 0 ? (
          <p className="t-small text-soft">Nobody has joined your tribe yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="hand-member-list">
            {ctx.members.map((m) => (
              <li key={m.person} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`hand-member-${m.person}`}>
                <span className="flex flex-col">
                  <span className="font-medium">{m.name}</span>
                  <span className="t-small text-soft">
                    {!m.wa ? "Has not said yes to WhatsApp" : !m.open ? "Their details are not open to you yet" : m.onlyWa ? "WhatsApp is the only way to reach them" : "Said yes to WhatsApp"}
                  </span>
                </span>
                {m.wa && m.open ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`hand-open-${m.person}`}
                    loading={d.busy === m.person}
                    disabled={!pText.trim()}
                    onClick={() =>
                      void d.go(m.person, async () => {
                        const r = await openMemberChatAction(m.person, ctx.tribe.id, pKind, withFirst(pText, m.first));
                        if (!r.ok) return r;
                        setOpen({ key: m.person, log: r.data.log, link: r.data.link, label: r.data.first });
                        window.open(r.data.link, "_blank", "noopener,noreferrer");
                        return { ok: true };
                      })
                    }
                  >
                    Message {m.first}
                  </Button>
                ) : null}
                {open?.key === m.person ? (
                  <div className="w-full">
                    <Opened open={open} d={d} close={() => setOpen(null)} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {reachable.length === 0 && ctx.members.length > 0 ? <p className="t-small text-soft">None of your members can be messaged on WhatsApp from here yet.</p> : null}
        <Notice error={d.error} saved={d.saved} />
      </section>

      {ctx.recent.length > 0 ? (
        <details className="card p-5 sm:p-6">
          <summary className="t-small cursor-pointer font-medium">What you have sent lately</summary>
          <ul className="t-small mt-3 flex flex-col gap-2" data-testid="hand-recent">
            {ctx.recent.map((l) => (
              <li key={l.id}>
                <span className="text-soft">{whenText(l.at)}</span> · {l.scope === "group" ? "to the group" : `to ${l.person ?? "a member"}`}: {KIND_WORDS[l.kind] ?? l.kind}
                {l.by ? ` (${l.by})` : ""} · {l.outcome === "sent" ? "sent" : l.outcome === "skipped" ? "left" : "opened"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Opened({ open, d, close }: { open: { key: string; log: number; link: string; label: string }; d: ReturnType<typeof useDo>; close: () => void }) {
  return (
    <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface-strong px-4 py-3" data-testid="hand-opened">
      <p className="t-small">
        WhatsApp should have opened for {open.label}. If it did not,{" "}
        <a href={open.link} target="_blank" rel="noopener noreferrer" className="underline">
          open it here
        </a>
        . Did you send it?
      </p>
      <div className="flex flex-wrap gap-3">
        <Button size="sm" variant="solid" data-testid="hand-sent" loading={d.busy === "mark"} onClick={() => void d.go("mark", () => markHandAction(open.log, "sent").then((r) => (r.ok ? { ok: true as const } : r)), { saved: "Marked as sent.", after: close })}>
          Yes, I sent it
        </Button>
        <Button size="sm" variant="ghost" data-testid="hand-skipped" loading={d.busy === "mark"} onClick={() => void d.go("mark", () => markHandAction(open.log, "skipped").then((r) => (r.ok ? { ok: true as const } : r)), { saved: "Noted: left for now.", after: close })}>
          I left it
        </Button>
        <a href="#hand-members" className={buttonClasses({ variant: "quiet", size: "sm" })} onClick={close}>
          Close
        </a>
      </div>
    </div>
  );
}
