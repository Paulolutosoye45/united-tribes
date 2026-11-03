"use client";

import { useEffect, useRef, useState } from "react";
import { deleteAudienceAction, previewAudienceAction, saveAudienceAction } from "@/app/(app)/admin/announcements/actions";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { APPLICATION_STAGES, AUDIENCE_KINDS, LEFT_OUT_REASONS, REACH_CAUSES, STAFF_ROLES, audienceLabel } from "@/lib/outreach/labels";
import type { AudiencePreview, AudienceSpec, SavedAudience } from "@/lib/outreach/types";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";

type Community = { id: string; name: string };
type Props = {
  spec: AudienceSpec;
  onChange: (spec: AudienceSpec, label: string) => void;
  onPreview: (p: AudiencePreview | null) => void;
  saved: SavedAudience[];
  communities: Community[];
  /** A champion writes to their own community only. */
  champion: boolean;
  /** Contact gaps is On: "cannot be reached on WhatsApp" is offered as a choice. */
  reach?: boolean;
};

const select = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";

/** Who it is for: a rule over live records, with a live count. Never a list of people, and never an uploaded one. */
export function AudiencePicker({ spec, onChange, onPreview, saved, communities, champion, reach = false }: Props) {
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const d = useDo();
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const done = await previewAudienceAction(spec);
        if (mine !== seq.current) return;
        if (done.ok) {
          setPreview(done.data);
          setProblem(null);
          onPreview(done.data);
        } else {
          setProblem(done.message);
          setPreview(null);
          onPreview(null);
        }
      } catch {
        if (mine === seq.current) setProblem("We couldn’t count that. Check your connection.");
      }
      if (mine === seq.current) setLoading(false);
    }, 250);
    return () => clearTimeout(t);
    // onPreview is stable enough for a screen that holds its own state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec)]);

  const set = (next: AudienceSpec) => onChange(next, audienceLabel(next, communities));
  const kinds = champion
    ? AUDIENCE_KINDS.filter((k) => ["everyone", "started", "finished_no_tribe", "in_tribe"].includes(k.kind))
    : AUDIENCE_KINDS.filter((k) => k.kind !== "cannot_reach" || reach || spec.kind === "cannot_reach");
  const withCommunity = ["everyone", "started", "finished_no_tribe", "in_tribe", "cannot_reach"].includes(spec.kind);
  const left = preview ? Object.entries(preview.skipped).filter(([, n]) => n > 0) : [];
  const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="t-heading mb-1">Who is this for?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {kinds.map((k) => {
            const on = spec.kind === k.kind;
            return (
              <button
                key={k.kind}
                type="button"
                aria-pressed={on}
                onClick={() => set({ kind: k.kind, ...(k.kind === "cannot_reach" ? { cause: "either" as const } : {}), ...(champion && spec.community ? { community: spec.community } : {}) })}
                className={`press card flex flex-col gap-0.5 p-4 text-left transition-colors ${on ? "ring-2 ring-ink" : "hover:bg-surface"}`}
              >
                <span className="font-semibold">{k.label}</span>
                <span className="t-small text-soft">{k.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {spec.kind === "started" ? (
        <label className="flex flex-col gap-2">
          <span className="t-small font-medium">How long since they last did anything?</span>
          <select className={select} value={spec.idle_days ?? 0} onChange={(e) => set({ ...spec, idle_days: Number(e.target.value) || undefined })}>
            <option value={0}>Any time</option>
            <option value={3}>3 days or more</option>
            <option value={7}>A week or more</option>
            <option value={14}>Two weeks or more</option>
            <option value={21}>Three weeks or more</option>
          </select>
        </label>
      ) : null}

      {spec.kind === "cannot_reach" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="t-small font-medium">Which of them</span>
            <select className={select} value={spec.cause ?? "either"} onChange={(e) => set({ ...spec, cause: e.target.value as AudienceSpec["cause"] })}>
              {REACH_CAUSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <p className="t-small text-soft">
            People who have chosen not to share, people whose contact has not opened yet and people with no way to be emailed are never included. Nobody is asked more than three times, or twice in two weeks.
          </p>
          {spec.tribe ? (
            <p className="t-small">
              Only one tribe.{" "}
              <button type="button" className="underline" onClick={() => set({ ...spec, tribe: undefined })}>
                Every tribe instead
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {spec.kind === "finished_no_tribe" ? (
        <label className="flex flex-col gap-2">
          <span className="t-small font-medium">People with no tribe that fits yet</span>
          <select className={select} value={spec.no_fit ?? "exclude"} onChange={(e) => set({ ...spec, no_fit: e.target.value as AudienceSpec["no_fit"] })}>
            <option value="exclude">Leave them out (they are on the office’s own list)</option>
            <option value="include">Include them</option>
            <option value="only">Only them</option>
          </select>
        </label>
      ) : null}

      {spec.kind === "leader_applicants" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="t-small mb-1 font-medium">How far they have got</legend>
          <div className="flex flex-wrap gap-2">
            {APPLICATION_STAGES.map((s) => (
              <Chip key={s.value} selected={spec.stages?.includes(s.value)} onClick={() => set({ ...spec, stages: toggle(spec.stages, s.value) })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}

      {spec.kind === "staff" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="t-small mb-1 font-medium">Which roles</legend>
          <div className="flex flex-wrap gap-2">
            {STAFF_ROLES.map((r) => (
              <Chip key={r.value} selected={spec.roles?.includes(r.value)} onClick={() => set({ ...spec, roles: toggle(spec.roles, r.value) })}>
                {r.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}

      {withCommunity && communities.length > 0 ? (
        <label className="flex flex-col gap-2">
          <span className="t-small font-medium">{champion ? "Your community" : "Narrow to one community (optional)"}</span>
          <select className={select} value={spec.community ?? ""} onChange={(e) => set({ ...spec, community: e.target.value || undefined })} disabled={champion && communities.length === 1}>
            {champion ? null : <option value="">All communities</option>}
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section aria-live="polite" className="night rounded-[var(--radius-card)] p-5" data-testid="audience-count">
        {problem ? (
          <p className="text-white/90">{problem}</p>
        ) : preview ? (
          <div className="flex flex-col gap-2">
            <p className="t-title" style={{ opacity: loading ? 0.6 : 1 }}>
              {preview.will_send.toLocaleString("en")} <span className="t-body text-white/80">{preview.will_send === 1 ? "person will get this" : "people will get this"}</span>
            </p>
            {left.length > 0 ? (
              <p className="t-small text-white/75">
                {(preview.total - preview.will_send).toLocaleString("en")} more are left out automatically:{" "}
                {left.map(([k, n]) => `${n} ${(LEFT_OUT_REASONS[k] ?? k).toLowerCase()}`).join(", ")}.
              </p>
            ) : (
              <p className="t-small text-white/75">Counted from live records, so it is right at the moment you send.</p>
            )}
            {preview.needs_approval ? <p className="t-small text-gold">Another person will need to approve this before it goes.</p> : null}
          </div>
        ) : (
          <p className="text-white/80">Counting…</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Saved groups">
        {saved.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="t-small font-medium">Saved groups (rules, never lists of people)</p>
            <div className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1">
                  <Chip onClick={() => set(s.spec)}>{s.name}</Chip>
                  <button
                    type="button"
                    className="press t-small min-h-11 rounded-full px-2 text-soft hover:text-ink"
                    aria-label={`Delete saved group ${s.name}`}
                    onClick={() => void d.go(`del-${s.id}`, async () => (await deleteAudienceAction(s.id)))}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className="t-small text-soft">Save this rule to use again</span>
            <input className={select} value={name} maxLength={80} placeholder="For example: quiet for a week" onChange={(e) => setName(e.target.value)} />
          </label>
          <Button
            variant="quiet"
            size="md"
            disabled={name.trim().length < 2}
            loading={d.busy === "save"}
            onClick={() =>
              void d.go(
                "save",
                async () => {
                  const done = await saveAudienceAction(name.trim(), spec, audienceLabel(spec, communities));
                  return done.ok ? { ok: true } : done;
                },
                { saved: "Saved. It is a rule, so it is counted fresh every time.", after: () => setName("") },
              )
            }
          >
            Save
          </Button>
        </div>
        <Notice error={d.error} saved={d.saved} />
      </section>
    </div>
  );
}
