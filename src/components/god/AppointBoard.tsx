"use client";

import Link from "next/link";
import { useState } from "react";
import { appointAction, findPeopleAction, stepDownAction, suggestAction } from "@/app/(app)/god/appointments/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import {
  APPOINT_PROMISE,
  EMPTY_FORM,
  PART_KEYS,
  PART_LABEL,
  SEARCH_MIN,
  STEP_DOWN_PROMISE,
  demandText,
  formProblem,
  matchLine,
  type AppointForm,
  type Appointment,
  type FoundPerson,
  type Suggestion,
  type Suggestions,
} from "@/lib/god/appointments";
import { GOAL_RELATIONS, LEAD_BEST } from "@/lib/leaders/options";

type Track = { slug: string; name: string; ages: string };
type Community = { slug: string; name: string; goals: { slug: string; title: string }[] };

/**
 * Appointing a leader. Find the person, answer five short questions about them, read the tribes that suit them and the tribes members
 * are waiting for, and appoint to one. It starts their Tribe Card and gives them the leader role. A pastor still approves the card and
 * the Academy still certifies them, so members see nothing until both are done.
 */
export function AppointBoard({ tracks, communities, appointments }: { tracks: Track[]; communities: Community[]; appointments: Appointment[] }) {
  const d = useDo();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<FoundPerson[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState<FoundPerson | null>(null);
  const [form, setForm] = useState<AppointForm>(EMPTY_FORM);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  const community = communities.find((c) => c.slug === form.community) ?? null;
  const formIssue = formProblem(form);

  function setField<K extends keyof AppointForm>(key: K, value: AppointForm[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "community") next.goal = "";
      if (key === "goal" && !value) next.relation = "";
      return next;
    });
    // The suggestions belong to the answers they were made from
    setSuggestions(null);
    setPicked(null);
    setProblem(null);
    setSaid(null);
    d.clear();
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < SEARCH_MIN) return setProblem(`Type at least ${SEARCH_MIN} letters.`);
    setSearching(true);
    setProblem(null);
    const r = await findPeopleAction(query);
    setSearching(false);
    if (!r.ok) return setProblem(r.message);
    setPeople(r.people);
  }

  function choosePerson(p: FoundPerson) {
    setPerson(p);
    setSuggestions(null);
    setPicked(null);
    setProblem(null);
    setSaid(null);
    d.clear();
  }

  async function suggest() {
    if (!person || formIssue) return;
    setAsking(true);
    setProblem(null);
    setPicked(null);
    const r = await suggestAction(person.id, form);
    setAsking(false);
    if (!r.ok) return setProblem(r.message);
    setSuggestions(r.suggestions);
  }

  async function appoint() {
    if (!person || !picked) return;
    const ok = await d.go("appoint", async () => {
      const r = await appointAction(person.id, form, picked.goalId, note);
      if (r.ok) setSaid(r.note);
      return r;
    });
    if (ok) {
      setPerson(null);
      setPeople(null);
      setQuery("");
      setForm(EMPTY_FORM);
      setSuggestions(null);
      setPicked(null);
      setNote("");
    }
  }

  const blocked = person ? person.appointed || person.leads > 0 : false;

  return (
    <div className="flex flex-col gap-8" data-testid="appoint-board">
      <Notice error={d.error} saved={said} />

      <section aria-labelledby="who-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="who-heading" className="t-heading">
          1. Who
        </h2>
        {person ? (
          <div className="flex flex-wrap items-center justify-between gap-3" data-testid="chosen-person">
            <span className="flex min-w-0 items-center gap-3">
              <Avatar name={person.name} size={40} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{person.name}</span>
                <span className="t-small block truncate text-soft">{person.email}</span>
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => (setPerson(null), setSuggestions(null), setPicked(null))}>
              Choose someone else
            </Button>
          </div>
        ) : (
          <>
            <form onSubmit={(e) => void search(e)} role="search" className="flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email"
                aria-label="Search for a person"
                className="h-13 w-full rounded-full border-[1.5px] border-line bg-raised px-5 text-base placeholder:text-soft/70 hover:border-soft focus:border-ink focus:outline-none"
                style={{ height: "3.25rem" }}
              />
              <Button type="submit" variant="quiet" size="md" loading={searching}>
                Search
              </Button>
            </form>
            {people && people.length === 0 ? <p className="t-body text-soft">Nobody matches. They need to have signed in once.</p> : null}
            {people && people.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
                {people.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="t-small block truncate text-soft">
                        {p.email}
                        {p.leads > 0 ? ` · leads ${p.leads} ${p.leads === 1 ? "tribe" : "tribes"}` : ""}
                        {p.appointed ? " · already appointed" : ""}
                        {p.hasApplication ? " · has an approved application" : ""}
                      </span>
                    </span>
                    <Button size="sm" variant="quiet" disabled={p.appointed || p.leads > 0} onClick={() => choosePerson(p)}>
                      {p.appointed ? "Already appointed" : p.leads > 0 ? "Already leads" : "Choose"}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {person ? (
        <section aria-labelledby="about-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h2 id="about-heading" className="t-heading">
              2. A few things about them
            </h2>
            <p className="t-small text-soft">No application sits behind an appointment, so these five answers stand in for it. Nothing is saved until you appoint.</p>
          </div>
          {blocked ? <p className="t-body text-soft">{person.appointed ? "They are already appointed. Step them down first." : "They already lead a tribe."}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Stage of life" value={form.track} onChange={(e) => setField("track", e.target.value)}>
              <option value="">Choose one</option>
              {tracks.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} · {t.ages}
                </option>
              ))}
            </Select>
            <Select label="How they lead best" value={form.lead_best} onChange={(e) => setField("lead_best", e.target.value)}>
              <option value="">Choose one</option>
              {LEAD_BEST.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select label="A community they have lived in (optional)" value={form.community} onChange={(e) => setField("community", e.target.value)}>
              <option value="">None in particular</option>
              {communities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="A goal they have walked (optional)" value={form.goal} disabled={!community} onChange={(e) => setField("goal", e.target.value)}>
              <option value="">{community ? "None in particular" : "Choose a community first"}</option>
              {community?.goals.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.title}
                </option>
              ))}
            </Select>
            {form.goal ? (
              <Select label="That goal is" value={form.relation} onChange={(e) => setField("relation", e.target.value)}>
                <option value="">Choose one</option>
                {GOAL_RELATIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <label className="t-small flex cursor-pointer items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={form.care_cleared} onChange={(e) => setField("care_cleared", e.target.checked)} />
            <span>
              <strong>A pastor has cleared them for sensitive subjects.</strong> Without this, tribes about a sensitive subject are not offered to them.
            </span>
          </label>
          {problem ? (
            <p role="alert" className="t-small text-danger">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" variant="solid" loading={asking} disabled={blocked || formIssue !== null} onClick={() => void suggest()}>
              Show me the tribes
            </Button>
            {formIssue && (form.track || form.lead_best) ? <span className="t-small text-soft">{formIssue}</span> : null}
          </div>
        </section>
      ) : problem ? (
        <p role="alert" className="t-small text-danger">
          {problem}
        </p>
      ) : null}

      {person && suggestions ? (
        suggestions.status === "no_model" ? (
          <section className="card flex flex-col gap-2 p-5 sm:p-6" data-testid="no-model">
            <h2 className="t-heading">3. Where they could lead</h2>
            <p className="t-body text-soft">The pastor has not approved a fit model yet, so there is nothing to compare. Ask the pastor to approve one on the leader pipeline page.</p>
          </section>
        ) : (
          <section aria-labelledby="where-heading" className="flex flex-col gap-6" data-testid="suggestions">
            <div>
              <h2 id="where-heading" className="t-heading">
                3. Where they could lead
              </h2>
              <p className="t-small text-soft">Model {suggestions.model}. Both lists come from the same comparison the application screen uses. Only you see the five parts.</p>
            </div>
            <SuggestionList title="Best fits for them" empty="No tribe reached a good match for these answers." items={suggestions.options} picked={picked} onPick={setPicked} />
            <SuggestionList title="Where members are waiting" empty="Nobody is waiting for a leader right now." items={suggestions.needed} picked={picked} onPick={setPicked} showDemand />
          </section>
        )
      ) : null}

      {person && picked ? (
        <section aria-labelledby="confirm-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="appoint-confirm">
          <h2 id="confirm-heading" className="t-heading">
            Appoint {person.name} to “{picked.title}”?
          </h2>
          <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
            {APPOINT_PROMISE.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {picked.careFlag ? (
            <p role="alert" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3">
              This tribe is about a sensitive subject. Tick “A pastor has cleared them for sensitive subjects” above and show the tribes again, or choose another.
            </p>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">A note for yourself (optional)</span>
            <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: asked by the pastor in October" />
          </label>
          <div className="flex gap-3">
            <Button size="md" variant="solid" loading={d.busy === "appoint"} disabled={picked.careFlag} onClick={() => void appoint()}>
              Yes, appoint
            </Button>
            <Button size="md" variant="ghost" onClick={() => setPicked(null)}>
              Not yet
            </Button>
          </div>
        </section>
      ) : null}

      <Appointed appointments={appointments} />
    </div>
  );
}

function SuggestionList({
  title,
  empty,
  items,
  picked,
  onPick,
  showDemand = false,
}: {
  title: string;
  empty: string;
  items: Suggestion[];
  picked: Suggestion | null;
  onPick: (s: Suggestion) => void;
  showDemand?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">{title}</h3>
      {items.length === 0 ? <p className="t-body text-soft">{empty}</p> : null}
      <ul className="flex flex-col gap-3">
        {items.map((s) => (
          <li key={`${title}-${s.goalId}`} className="card flex flex-col gap-3 p-4" data-testid={`suggestion-${s.goalId}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{s.title}</p>
                <p className="t-small text-soft">
                  {s.community} · {matchLine(s.label, s.degree)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.sensitive ? <Badge tone="charcoal">Sensitive</Badge> : null}
                {s.careFlag ? <Badge tone="flame">Needs a pastor’s clearance</Badge> : null}
                {s.nextTo ? <Badge tone="outline">Next stage of life</Badge> : null}
                <Button size="sm" variant={picked?.goalId === s.goalId ? "solid" : "quiet"} onClick={() => onPick(s)}>
                  {picked?.goalId === s.goalId ? "Chosen" : "Appoint here"}
                </Button>
              </div>
            </div>
            <dl className="grid grid-cols-5 gap-2 text-center" aria-label="The five parts of the match">
              {PART_KEYS.map((k) => (
                <div key={k}>
                  <dt className="t-small text-soft">{PART_LABEL[k]}</dt>
                  <dd className="font-semibold tabular-nums">{s.parts[k]}</dd>
                </div>
              ))}
            </dl>
            {showDemand || s.waiting > 0 || s.gap > 0 ? <p className="t-small text-soft">{demandText(s)}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Appointed({ appointments }: { appointments: Appointment[] }) {
  const d = useDo();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  async function step(a: Appointment) {
    const ok = await d.go(`step-${a.id}`, async () => {
      const r = await stepDownAction(a.id, reason);
      if (r.ok) setSaid(r.note);
      return r;
    });
    if (ok) {
      setOpen(null);
      setReason("");
    }
  }

  return (
    <section aria-labelledby="appointed-heading" className="flex flex-col gap-3" data-testid="appointed">
      <h2 id="appointed-heading" className="t-heading">
        Appointed leaders
      </h2>
      <Notice error={d.error} saved={said} />
      {appointments.length === 0 ? <p className="card t-body p-5 text-soft">Nobody has been appointed yet.</p> : null}
      <ul className="flex flex-col gap-3">
        {appointments.map((a) => (
          <li key={a.id} className="card flex flex-col gap-3 p-5" data-testid={`appointment-${a.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{a.person.name}</p>
                <p className="t-small text-soft">
                  {a.goal || "A tribe"}
                  {a.community ? ` · ${a.community}` : ""} · {matchLine(a.label, a.degree)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.active ? "gold" : "outline"}>{a.active ? "Active" : "Stepped down"}</Badge>
                {a.tribe ? <Badge tone="outline">{a.tribe.certified ? "Certified" : "Not certified yet"}</Badge> : null}
              </div>
            </div>
            <p className="t-small text-soft">
              Appointed {a.appointedAt ? formatShortDate(a.appointedAt) : ""}
              {a.steppedDownAt ? `, stepped down ${formatShortDate(a.steppedDownAt)}` : ""}.
              {a.tribe ? ` Tribe card: ${a.tribe.status.replace(/_/g, " ")}. ${a.tribe.members} ${a.tribe.members === 1 ? "member has" : "members have"} joined.` : ""}
              {a.careCleared ? " Cleared for sensitive subjects." : ""}
            </p>
            {a.flags.length > 0 ? <p className="t-small">{a.flags.join(". ")}.</p> : null}
            {a.note ? <p className="t-small text-soft">Your note: {a.note}</p> : null}
            {a.stepDownReason ? <p className="t-small text-soft">Why they stepped down: {a.stepDownReason}</p> : null}
            {a.tribe && a.active ? (
              <p className="t-small">
                <Link href={`/god/tribes/${a.tribe.id}`} className="font-semibold underline underline-offset-4">
                  Open the tribe
                </Link>
              </p>
            ) : null}
            {a.active ? (
              open === a.id ? (
                <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-4">
                  <p className="font-semibold">Step {a.person.name} down?</p>
                  <ul className="t-small flex list-disc flex-col gap-1 pl-5 text-soft">
                    {STEP_DOWN_PROMISE.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.95rem] font-medium">Why? (optional)</span>
                    <input className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <div className="flex gap-3">
                    <Button size="md" variant="solid" loading={d.busy === `step-${a.id}`} onClick={() => void step(a)}>
                      Yes, step down
                    </Button>
                    <Button size="md" variant="ghost" onClick={() => setOpen(null)}>
                      Not yet
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button size="sm" variant="quiet" onClick={() => (setOpen(a.id), setReason(""), d.clear())}>
                    Step down
                  </Button>
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
