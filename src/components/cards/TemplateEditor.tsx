"use client";

import { useState } from "react";
import { retireTemplateAction, saveTemplateAction, signOffTemplateAction } from "@/app/(app)/review/templates/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Input";
import {
  DEMAND_WORD,
  MODES,
  MODE_LABEL,
  SLOTS,
  SLOT_LABEL,
  TEXT_FIELDS,
  WAYS,
  WAY_LABEL,
  editDiff,
  editProblem,
  fieldsOf,
  notWritten,
  type EditFields,
  type Template,
} from "@/lib/cards/templates";

type Track = { slug: string; name: string };

/**
 * One ready-made card, open for reading and editing. The three Success Picture lines, the weekly ideas and the guardrail are what a
 * leader is shown. "Who leads it well", the four numbers for ways of leading and the sensitive mark are hidden: only the pastorate and
 * the compatibility test use them. Saving a signed-off card takes it back to waiting for sign-off, so nothing live changes unseen.
 */
export function TemplateEditor({ t, tracks, canEdit, canSign, onClose }: { t: Template; tracks: Track[]; canEdit: boolean; canSign: boolean; onClose: () => void }) {
  const d = useDo();
  const titleEditable = t.goalId === null;
  const [f, setF] = useState<EditFields>(() => fieldsOf(t));
  const [said, setSaid] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"sign" | "retire" | null>(null);
  const [read, setRead] = useState(false);

  const diff = editDiff(t, f, titleEditable);
  const dirty = Object.keys(diff).length > 0;
  const problem = canEdit ? editProblem(f, titleEditable) : null;
  const unwritten = notWritten(t);
  const set = <K extends keyof EditFields>(key: K, value: EditFields[K]) => {
    setF((cur) => ({ ...cur, [key]: value }));
    setSaid(null);
    d.clear();
  };

  async function save() {
    await d.go("save", async () => {
      const r = await saveTemplateAction(t.slug, diff);
      if (r.ok) setSaid(r.note ?? "Saved.");
      return r;
    });
  }
  async function sign() {
    const ok = await d.go("sign", async () => {
      const r = await signOffTemplateAction(t.slug);
      if (r.ok) setSaid(r.note ?? "Signed off.");
      return r;
    });
    if (ok) setConfirm(null);
  }
  async function retire() {
    const ok = await d.go("retire", async () => {
      const r = await retireTemplateAction(t.slug);
      if (r.ok) setSaid(r.note ?? "Retired.");
      return r;
    });
    if (ok) setConfirm(null);
  }

  return (
    <div className="flex flex-col gap-5 border-t border-line pt-4" data-testid={`template-${t.slug}`}>
      <Notice error={d.error} saved={said} />

      {unwritten.length > 0 ? (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="unwritten">
          Still to be written: {unwritten.join(", ").toLowerCase()}. A card cannot be signed off until these are written.
        </p>
      ) : null}
      {t.status === "signed_off" && canEdit ? (
        <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3">This card is signed off and its goal is live. Saving a change takes it back to waiting for sign-off until it is signed off again.</p>
      ) : null}

      <fieldset disabled={!canEdit || d.busy !== null} className="flex flex-col gap-4">
        {titleEditable ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">Title</span>
            <input className="input" value={f.title} maxLength={100} onChange={(e) => set("title", e.target.value)} />
          </label>
        ) : (
          <p className="t-small text-soft">The title of a card whose goal exists is changed in the catalogue.</p>
        )}

        {TEXT_FIELDS.map((x) => (
          <Textarea
            key={x.key}
            label={x.label}
            rows={x.rows}
            className="!min-h-0"
            value={f[x.key]}
            maxLength={x.max}
            onChange={(e) => set(x.key, e.target.value)}
            hint={`${f[x.key].trim().length} of ${x.max} characters`}
          />
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Meeting time" value={f.rhythm_slot} onChange={(e) => set("rhythm_slot", e.target.value)}>
            {SLOTS.map((s) => (
              <option key={s} value={s}>
                {SLOT_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select label="Online or in person" value={f.rhythm_mode} onChange={(e) => set("rhythm_mode", e.target.value)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[0.95rem] font-medium">Life stages it suits</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {tracks.map((k) => (
              <label key={k.slug} className="t-small flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={f.track_slugs.includes(k.slug)}
                  onChange={(e) => set("track_slugs", e.target.checked ? [...f.track_slugs, k.slug] : f.track_slugs.filter((s) => s !== k.slug))}
                />
                {k.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4" data-testid="hidden-profile">
          <div>
            <p className="text-[0.95rem] font-medium">What the group asks of its leader</p>
            <p className="t-small text-soft">Hidden from leaders and members. Used to match a leader to this card. 0 is not needed, 3 is essential.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {WAYS.map((w) => {
              const key = `demand_${w}` as const;
              return (
                <Select key={w} label={WAY_LABEL[w]} value={String(f[key])} onChange={(e) => set(key, Number(e.target.value))}>
                  {DEMAND_WORD.map((word, n) => (
                    <option key={word} value={n}>
                      {n} · {word}
                    </option>
                  ))}
                </Select>
              );
            })}
          </div>
          <label className="t-small flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={f.sensitive} onChange={(e) => set("sensitive", e.target.checked)} />
            <span>
              <strong>A sensitive subject.</strong> It is signed off one card at a time, and only offered to a leader whose care result is high enough.
            </span>
          </label>
        </div>
      </fieldset>

      {problem && dirty ? (
        <p role="alert" className="t-small text-danger" data-testid="edit-problem">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button size="md" variant="solid" loading={d.busy === "save"} disabled={!dirty || problem !== null} onClick={() => void save()}>
            Save changes
          </Button>
        ) : null}
        {canSign && t.status !== "signed_off" ? (
          <Button size="md" variant="quiet" disabled={dirty || d.busy !== null || unwritten.length > 0} onClick={() => setConfirm("sign")}>
            Sign off
          </Button>
        ) : null}
        {canSign && t.status !== "retired" ? (
          <Button size="md" variant="ghost" disabled={d.busy !== null} onClick={() => setConfirm("retire")}>
            Retire
          </Button>
        ) : null}
        <Button size="md" variant="ghost" onClick={onClose}>
          Close
        </Button>
        {dirty && canSign && t.status !== "signed_off" ? <span className="t-small text-soft">Save your changes before signing off.</span> : null}
      </div>

      {confirm === "sign" ? (
        <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
          <p className="font-semibold">Sign off “{t.title}”?</p>
          <p className="t-small text-soft">
            {t.goalId ? "Its goal becomes live for members and leaders." : "A new goal is created for it, and it becomes live for members and leaders."} This is recorded with your name.
          </p>
          {t.sensitive ? (
            <label className="t-small flex cursor-pointer items-start gap-2 font-semibold">
              <input type="checkbox" className="mt-0.5" checked={read} onChange={(e) => setRead(e.target.checked)} />I have read this card, and it is right for a sensitive subject.
            </label>
          ) : null}
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "sign"} disabled={t.sensitive && !read} onClick={() => void sign()}>
              Yes, sign off
            </Button>
            <Button size="md" variant="ghost" onClick={() => setConfirm(null)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
      {confirm === "retire" ? (
        <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
          <p className="font-semibold">Retire “{t.title}”?</p>
          <p className="t-small text-soft">Its goal is switched off for new tribes and it is no longer offered to leaders. Tribes already running on it carry on. It can be signed off again later.</p>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "retire"} onClick={() => void retire()}>
              Yes, retire
            </Button>
            <Button size="md" variant="ghost" onClick={() => setConfirm(null)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
