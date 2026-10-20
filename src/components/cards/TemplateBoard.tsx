"use client";

import { useState } from "react";
import { signOffCommunityAction } from "@/app/(app)/review/templates/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { STATUS_LABEL, bulkEligible, demandLine, demandSummary, notWritten, type Template, type TemplateList } from "@/lib/cards/templates";
import { TemplateEditor } from "./TemplateEditor";

type Track = { slug: string; name: string };

/**
 * The ready-made Tribe Cards, community by community. Each community shows how many of its cards are signed off, lets a pastor or
 * director sign off the cards that are waiting in one go (sensitive ones are always signed off one at a time), and opens any card to
 * read or change it. Nothing is live until it has been signed off.
 */
export function TemplateBoard({ list, tracks, canEdit, canSign }: { list: TemplateList; tracks: Track[]; canEdit: boolean; canSign: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const tiles = [
    { label: "Signed off", value: list.counts.signedOff, note: `of ${list.counts.total} cards` },
    { label: "Waiting", value: list.counts.draft, note: "to read and sign off" },
    { label: "Sensitive left", value: list.communities.reduce((n, c) => n + c.sensitiveLeft, 0), note: "signed off one at a time" },
    { label: "Retired", value: list.counts.retired, note: "out of use" },
  ];

  async function signCommunity(id: string, name: string) {
    const ok = await d.go(`community-${id}`, async () => {
      const r = await signOffCommunityAction(id, name);
      if (r.ok) setSaid(r.note ?? "Done.");
      return r;
    });
    if (ok) setAsking(null);
  }

  return (
    <div className="flex flex-col gap-6" data-testid="template-board">
      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{t.label}</dt>
            <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
            <dd className="t-small text-soft">{t.note}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <a href="/review/templates/sheet" className="btn btn-quiet inline-flex h-10 items-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium" download>
          Download the review sheet
        </a>
        <span className="t-small text-soft">Every card in one spreadsheet, with a column for your decision and notes.</span>
      </div>

      <Notice error={d.error} saved={said} />

      <ul className="flex flex-col gap-4">
        {list.communities.map((c) => {
          const here = list.templates.filter((t) => t.communityId === c.communityId);
          const eligible = bulkEligible(list, c.communityId);
          const live = c.total - c.retired;
          const percent = live > 0 ? Math.round((c.signedOff / live) * 100) : 0;
          const isOpen = open === c.communityId;
          return (
            <li key={c.communityId} className="card flex flex-col gap-4 p-5" data-testid={`community-${c.slug}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="t-heading">{c.name}</h2>
                  <p className="t-small text-soft">
                    {c.signedOff} of {live} signed off{c.sensitiveLeft > 0 ? `, ${c.sensitiveLeft} sensitive left` : ""}
                    {c.retired > 0 ? `, ${c.retired} retired` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canSign && eligible.length > 0 ? (
                    <Button size="sm" variant="quiet" disabled={d.busy !== null} onClick={() => setAsking(c.communityId)}>
                      Sign off the {eligible.length} waiting
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.communityId)}>
                    {isOpen ? "Hide the cards" : `Read the ${here.length} cards`}
                  </Button>
                </div>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-surface-strong" role="img" aria-label={`${percent} percent signed off`}>
                <div className="h-full rounded-full" style={{ width: `${percent}%`, background: "linear-gradient(90deg, var(--crest-gold), var(--crest-flame))" }} />
              </div>

              {asking === c.communityId ? (
                <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4" data-testid={`ask-${c.slug}`}>
                  <p className="font-semibold">
                    Sign off {eligible.length} {eligible.length === 1 ? "card" : "cards"} in {c.name}?
                  </p>
                  <ul className="t-small flex list-disc flex-col gap-0.5 pl-5 text-soft">
                    {eligible.map((t) => (
                      <li key={t.slug}>{t.title}</li>
                    ))}
                  </ul>
                  <p className="t-small text-soft">
                    Their goals become live for members and leaders. {c.sensitiveLeft > 0 ? `The ${c.sensitiveLeft} sensitive ${c.sensitiveLeft === 1 ? "card is" : "cards are"} not included: open each one and sign it off yourself. ` : ""}This is recorded with your name.
                  </p>
                  <div className="flex gap-3">
                    <Button size="md" variant="solid" loading={d.busy === `community-${c.communityId}`} onClick={() => void signCommunity(c.communityId, c.name)}>
                      Yes, sign them off
                    </Button>
                    <Button size="md" variant="ghost" onClick={() => setAsking(null)}>
                      Not yet
                    </Button>
                  </div>
                </div>
              ) : null}

              {isOpen ? (
                <ul className="flex flex-col gap-3">
                  {here.map((t) => (
                    <CardRow key={t.slug} t={t} tracks={tracks} canEdit={canEdit} canSign={canSign} editing={editing === t.slug} onToggle={() => setEditing(editing === t.slug ? null : t.slug)} />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CardRow({ t, tracks, canEdit, canSign, editing, onToggle }: { t: Template; tracks: Track[]; canEdit: boolean; canSign: boolean; editing: boolean; onToggle: () => void }) {
  const unwritten = notWritten(t).length;
  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line bg-raised p-4" data-testid={`row-${t.slug}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <p className="font-semibold leading-snug">{t.title}</p>
          <p className="t-small text-soft">{unwritten > 0 ? `${unwritten} ${unwritten === 1 ? "part is" : "parts are"} still to be written` : t.whoFor}</p>
          <p className="t-small text-soft">
            {demandSummary(t.demand)} <span className="sr-only">({demandLine(t.demand)})</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.sensitive ? <Badge tone="charcoal">Sensitive</Badge> : null}
          <Badge tone={t.status === "signed_off" ? "gold" : t.status === "retired" ? "outline" : "flame"}>{STATUS_LABEL[t.status]}</Badge>
          <Button size="sm" variant="quiet" aria-expanded={editing} onClick={onToggle}>
            {editing ? "Close" : canEdit ? "Open" : "Read"}
          </Button>
        </div>
      </div>
      {editing ? <TemplateEditor t={t} tracks={tracks} canEdit={canEdit} canSign={canSign} onClose={onToggle} /> : null}
    </li>
  );
}
