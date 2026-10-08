"use client";

import { useMemo, useState } from "react";
import { removeRoleAction } from "@/app/(app)/admin/actions";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  hasName: boolean;
  roles: Role[];
  /** Roles the signed-in person may remove from this person. */
  removable: Role[];
};

/** Everyone who has signed in, with a search box that filters as you type. */
export function PeopleList({ people, limit }: { people: PersonRow[]; limit: number }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.roles.some((r) => ROLE_LABELS[r].toLowerCase().includes(q)),
    );
  }, [people, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-soft"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or role"
          aria-label="Search people"
          className="h-13 w-full rounded-full border-[1.5px] border-line bg-raised pl-11 pr-4 text-base placeholder:text-soft/70 hover:border-soft focus:border-ink focus:outline-none focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)]"
          style={{ height: "3.25rem" }}
        />
      </div>

      <p className="t-small text-soft" aria-live="polite">
        {query ? `${shown.length} of ${people.length} ${people.length === 1 ? "person" : "people"}` : `${people.length} ${people.length === 1 ? "person" : "people"}`}
        {!query && people.length >= limit ? `, newest ${limit}` : ""}
      </p>

      {shown.length === 0 ? (
        <p className="card t-body p-6 text-soft">Nobody matches “{query}”.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {shown.map((p) => {
            const extra = p.roles.filter((r) => r !== "member");
            return (
              <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex min-w-0 items-center gap-3.5">
                  <Avatar name={p.name} size={42} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    {p.hasName ? <p className="t-small truncate text-soft">{p.email}</p> : null}
                  </div>
                </div>
                <ul className="flex flex-wrap items-center gap-2 pl-[3.375rem] sm:pl-0" aria-label={`Roles for ${p.name}`}>
                  {extra.map((role) => (
                    <li key={role} className="flex items-center gap-0.5">
                      <Badge tone={role === "admin" ? "charcoal" : "gold"}>{ROLE_LABELS[role]}</Badge>
                      {p.removable.includes(role) ? (
                        <form action={removeRoleAction}>
                          <input type="hidden" name="person" value={p.id} />
                          <input type="hidden" name="role" value={role} />
                          <button
                            type="submit"
                            aria-label={`Remove ${ROLE_LABELS[role]} from ${p.name}`}
                            className="press grid h-9 w-9 place-items-center rounded-full text-soft hover:bg-surface-strong hover:text-ink"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                              <path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                  {extra.length === 0 ? <li className="t-small text-soft">Member</li> : null}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
