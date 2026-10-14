"use client";

import Link from "next/link";
import { useState } from "react";
import { deletePersonAction, savePersonAction, setPersonActiveAction } from "@/app/(app)/admin/referees/actions";
import { Notice } from "@/components/admin/Notice";
import { showContact } from "@/components/admin/referees/PreviewList";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/dates";
import { STANDINGS, STANDING_LABEL, type Standing } from "@/lib/leaders/referee/labels";
import { splitContacts } from "@/lib/leaders/referee/sheet/columns";
import type { DirectoryPerson } from "@/lib/leaders/referee/types";

export type DirectoryFilter = { q: string; standing: Standing | null; state: "active" | "retired" | "all"; page: number };

const PAGE_SIZE = 25;

const href = (f: DirectoryFilter, over: Partial<DirectoryFilter> = {}) => {
  const n = { ...f, ...over };
  const p = new URLSearchParams();
  if (n.q) p.set("q", n.q);
  if (n.standing) p.set("who", n.standing);
  if (n.state !== "active") p.set("show", n.state);
  if (n.page > 1) p.set("page", String(n.page));
  const s = p.toString();
  return `/admin/referees${s ? `?${s}` : ""}#list`;
};

/**
 * The list as it stands: search it, filter it, add someone, correct someone, take someone off. Everything also works by uploading
 * the spreadsheet again; this is for the odd person who needs fixing now.
 */
export function DirectoryBoard({ rows, total, filter }: { rows: DirectoryPerson[]; total: number; filter: DirectoryFilter }) {
  const [adding, setAdding] = useState(false);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chip = (active: boolean) =>
    cn(
      "press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.95rem] transition-colors",
      active ? "border-ink bg-ink font-semibold text-page" : "border-line bg-raised text-ink hover:border-soft",
    );

  return (
    <section id="list" aria-labelledby="list-h" className="flex flex-col gap-4" data-testid="directory">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="list-h" className="t-heading">
            The list
          </h2>
          <p className="t-small text-soft">{total.toLocaleString("en-NG")} {total === 1 ? "person" : "people"} {filter.state === "retired" ? "taken off" : filter.state === "all" ? "in all" : "on the list"}{filter.q ? ` matching “${filter.q}”` : ""}.</p>
        </div>
        <Button size="md" variant="quiet" onClick={() => setAdding((v) => !v)} aria-expanded={adding} data-testid="add-person">
          {adding ? "Close" : "Add a person"}
        </Button>
      </div>

      {adding ? <PersonForm person={null} onDone={() => setAdding(false)} /> : null}

      <nav aria-label="Filter the list" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <Link href={href(filter, { standing: null, page: 1 })} className={chip(filter.standing === null)} aria-current={filter.standing === null ? "page" : undefined}>
          Everyone
        </Link>
        {STANDINGS.map((s) => (
          <Link key={s} href={href(filter, { standing: s, page: 1 })} className={chip(filter.standing === s)} aria-current={filter.standing === s ? "page" : undefined}>
            {STANDING_LABEL[s]}s
          </Link>
        ))}
        <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden="true" />
        {(["active", "retired", "all"] as const).map((s) => (
          <Link key={s} href={href(filter, { state: s, page: 1 })} className={chip(filter.state === s)} aria-current={filter.state === s ? "page" : undefined}>
            {s === "active" ? "On the list" : s === "retired" ? "Taken off" : "All"}
          </Link>
        ))}
      </nav>

      <form action="/admin/referees" method="get" role="search" className="flex flex-wrap items-center gap-3">
        {filter.standing ? <input type="hidden" name="who" value={filter.standing} /> : null}
        {filter.state !== "active" ? <input type="hidden" name="show" value={filter.state} /> : null}
        <label htmlFor="dir-search" className="sr-only">
          Search by name, unit, phone or email
        </label>
        <input
          id="dir-search"
          name="q"
          defaultValue={filter.q}
          placeholder="Search name, unit, phone or email"
          maxLength={80}
          className="h-12 w-full max-w-sm rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base focus:border-ink focus:outline-none"
        />
        <button type="submit" className={buttonClasses({ variant: "quiet", size: "md" })}>
          Search
        </button>
        {filter.q ? (
          <Link href={href(filter, { q: "", page: 1 })} className="t-small text-soft underline underline-offset-4">
            Clear search
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="directory-empty">
          {filter.q ? "No one matches that here." : filter.state === "retired" ? "Nobody has been taken off the list." : "The list is empty. Upload your spreadsheet above, or add a person."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((p) => (
            <Person key={p.id} person={p} />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {filter.page > 1 ? (
            <Link href={href(filter, { page: filter.page - 1 })} className={buttonClasses({ variant: "quiet", size: "md" })}>
              Earlier
            </Link>
          ) : (
            <span />
          )}
          <span className="t-small text-soft">
            Page {filter.page} of {pages}
          </span>
          {filter.page < pages ? (
            <Link href={href(filter, { page: filter.page + 1 })} className={buttonClasses({ variant: "quiet", size: "md" })}>
              Later
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}

function Person({ person }: { person: DirectoryPerson }) {
  const [editing, setEditing] = useState(false);
  const run = useDo();

  if (editing) {
    return (
      <li className="card p-5">
        <PersonForm person={person} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className={cn("card flex flex-col gap-3 p-5", !person.active && "opacity-80")} data-testid="person" data-name={person.name}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold">{person.name}</p>
          <p className="t-small text-soft">{person.unit ?? "No unit given"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={person.standing === "pastor" ? "gold" : "neutral"}>{STANDING_LABEL[person.standing]}</Badge>
          {!person.active ? <Badge tone="outline">Taken off</Badge> : null}
        </div>
      </div>
      <ul className="t-small flex flex-col gap-0.5 break-words text-soft">
        {person.contacts.map((c) => (
          <li key={c.value}>
            <span className="text-ink/70">{c.kind === "email" ? "Email" : "Phone"}:</span> {showContact(c.value)}
          </li>
        ))}
        {person.contacts.length === 0 ? <li>No phone or email</li> : null}
      </ul>
      {person.note ? <p className="t-small text-soft">Note: {person.note}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="quiet" onClick={() => setEditing(true)} data-testid="edit-person">
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={run.busy === "active"}
          onClick={() => void run.go("active", () => setPersonActiveAction(person.id, !person.active), { saved: person.active ? `${person.name} is off the list.` : `${person.name} is back on the list.` })}
        >
          {person.active ? "Take off the list" : "Put back on the list"}
        </Button>
        {person.updatedAt ? <span className="t-small ml-auto text-soft">Updated {formatShortDate(person.updatedAt)}</span> : null}
      </div>
      <Notice error={run.error} saved={run.saved} />
    </li>
  );
}

function PersonForm({ person, onDone }: { person: DirectoryPerson | null; onDone: () => void }) {
  const run = useDo();
  const [name, setName] = useState(person?.name ?? "");
  const [standing, setStanding] = useState<Standing | "">(person?.standing ?? "");
  const [unit, setUnit] = useState(person?.unit ?? "");
  const [contacts, setContacts] = useState((person?.contacts ?? []).map((c) => showContact(c.value)).join("\n"));
  const [note, setNote] = useState(person?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!standing) return;
    await run.go("save", () => savePersonAction(person?.id ?? null, { name, standing, unit, note, contacts: contacts.split(/\n+/).flatMap(splitContacts) }), {
      saved: person ? `${name.trim()} is saved.` : `${name.trim()} is on the list.`,
      after: onDone,
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="pop-in flex flex-col gap-4"
      data-testid="person-form"
    >
      <h3 className="t-heading">{person ? "Edit this person" : "Add a person"}</h3>
      <Input label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Pastor Ife Adeyemi" />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pf-standing" className="t-small font-medium">
          Role
        </label>
        <select
          id="pf-standing"
          value={standing}
          onChange={(e) => setStanding(e.target.value as Standing | "")}
          className="h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none"
        >
          <option value="">Choose…</option>
          {STANDINGS.map((s) => (
            <option key={s} value={s}>
              {STANDING_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <Input label="Unit" optional value={unit} maxLength={80} onChange={(e) => setUnit(e.target.value)} placeholder="Ushers, Choir, Ota Central" />
      <Textarea label="Phone numbers and emails" rows={3} value={contacts} onChange={(e) => setContacts(e.target.value)} hint="One on each line. A referee has to prove they hold one of these." />
      <Input label="Note" optional value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} hint="Only pastors, the director and admins see this." />
      <Notice error={run.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="md" loading={run.busy === "save"} disabled={!standing || name.trim().length < 2}>
          {person ? "Save" : "Add to the list"}
        </Button>
        <Button type="button" size="md" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {person ? (
          confirmDelete ? (
            <span className="ml-auto flex items-center gap-2">
              <span className="t-small text-danger">Delete for good?</span>
              <Button type="button" size="sm" variant="quiet" loading={run.busy === "delete"} onClick={() => void run.go("delete", () => deletePersonAction(person.id), { after: onDone })}>
                Yes, delete
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button type="button" size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => setConfirmDelete(true)}>
              Delete this person
            </Button>
          )
        ) : null}
      </div>
    </form>
  );
}
