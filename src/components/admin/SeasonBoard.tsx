"use client";

import { useState } from "react";
import { saveSeasonAction, setSeasonStatusAction } from "@/app/(app)/admin/seasons/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDate, plural } from "@/lib/dates";
import type { AdminSeason, AdminSeasons } from "@/lib/admin/types";
import { SEASON_MOVES, SEASON_STATUS, seasonWhen } from "@/lib/admin/wording";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The last day of a season that starts on `start` and runs `weeks` weeks, as an ISO date. Null when it cannot be worked out. */
function endOf(start: string, weeks: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(weeks)) return null;
  const t = Date.parse(`${start}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + (weeks * 7 - 1) * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(date: string): string | null {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? null : WEEKDAYS[new Date(t).getUTCDay()];
}

export function SeasonBoard({ data }: { data: AdminSeasons }) {
  const preparing = data.seasons.find((s) => s.status === "planning" || s.status === "open");

  return (
    <div className="flex flex-col gap-8">
      {data.can_edit ? (
        preparing ? (
          <p className="card t-body p-5 text-soft">
            <strong className="text-ink">{preparing.name}</strong> is still being prepared. Run it or close it before planning another season: leaders and members are given the season that is being prepared.
          </p>
        ) : (
          <SeasonForm key="new" season={null} onDone={() => undefined} />
        )
      ) : null}

      {data.seasons.length === 0 ? (
        <p className="card t-body p-6 text-soft">No season has been planned yet.{data.can_edit ? " Plan the first one above." : ""}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.seasons.map((s) => (
            <li key={s.id}>
              <SeasonCard season={s} today={data.today} canEdit={data.can_edit} />
            </li>
          ))}
        </ul>
      )}

      <p className="t-small measure text-soft">
        The weekly messages, the guides and the reports follow the dates, not the label. Planning and Open work the same way for the system; Open is how you tell everyone that registration has begun. A season starts on a Sunday and runs from 4 to 24 weeks.
      </p>
    </div>
  );
}

function SeasonCard({ season: s, today, canEdit }: { season: AdminSeason; today: string; canEdit: boolean }) {
  const d = useDo();
  const [editing, setEditing] = useState(false);
  const status = SEASON_STATUS[s.status];
  const moves = canEdit ? SEASON_MOVES[s.status] : [];

  async function move(to: AdminSeason["status"], confirmText: string | null) {
    if (confirmText && !window.confirm(confirmText)) return;
    await d.go(to, () => setSeasonStatusAction(s.id, to));
  }

  return (
    <article className="card flex flex-col gap-4 p-5 sm:p-6" aria-label={s.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="t-heading">{s.name}</h2>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="t-body text-soft">
            {formatDate(s.starts_on)} to {formatDate(s.ends_on)} · {plural(s.weeks, "week")} · {seasonWhen(s.week, s.weeks, s.starts_on, today)}
          </p>
          {s.sermon_series ? <p className="t-small text-soft">Sermon series: {s.sermon_series}</p> : null}
        </div>
        <dl className="flex gap-5 text-right">
          <div>
            <dt className="t-small text-soft">Tribes</dt>
            <dd className="font-semibold">
              {s.approved}
              <span className="t-small font-normal text-soft"> of {s.tribes}</span>
            </dd>
          </div>
          <div>
            <dt className="t-small text-soft">Members</dt>
            <dd className="font-semibold">{s.members}</dd>
          </div>
        </dl>
      </div>
      <p className="t-small text-soft">{status.line}</p>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {moves.map((m) => (
            <Button key={m.to} size="sm" variant={m.to === "planning" ? "quiet" : "solid"} loading={d.busy === m.to} disabled={d.busy !== null} onClick={() => void move(m.to, m.confirm)}>
              {m.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      ) : null}
      <Notice error={d.error} />
      {editing ? <SeasonForm season={s} onDone={() => setEditing(false)} /> : null}
    </article>
  );
}

function SeasonForm({ season, onDone }: { season: AdminSeason | null; onDone: () => void }) {
  const d = useDo();
  const [name, setName] = useState(season?.name ?? "");
  const [starts, setStarts] = useState(season?.starts_on ?? "");
  const [weeks, setWeeks] = useState(String(season?.weeks ?? 12));
  const [series, setSeries] = useState(season?.sermon_series ?? "");
  const locked = season !== null && !season.can_move_dates;
  const day = starts ? weekdayOf(starts) : null;
  const ends = endOf(starts, Number(weeks));

  async function save() {
    const ok = await d.go(
      "save",
      () => saveSeasonAction(season?.id ?? null, name, starts, Number(weeks), series),
      { saved: season ? "Saved." : "Season planned.", after: season ? onDone : undefined },
    );
    if (ok && !season) {
      setName("");
      setStarts("");
      setWeeks("12");
      setSeries("");
    }
  }

  return (
    <form
      noValidate
      aria-label={season ? `Edit ${season.name}` : "Plan a season"}
      className={season ? "flex flex-col gap-4 border-t border-line pt-4" : "card flex flex-col gap-4 p-5 sm:p-7"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {season ? null : (
        <div className="flex flex-col gap-1">
          <h2 className="t-heading">Plan a season</h2>
          <p className="t-body text-soft">Choose when it starts and how long it runs. Leaders can then draft their Tribe Cards for it.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Season 2, 2027" />
        <Input label="Sermon series" optional value={series} onChange={(e) => setSeries(e.target.value)} maxLength={120} hint="The series this season follows. Each weekly guide names its own sermon." />
        <Input
          label="Starts on"
          type="date"
          value={starts}
          onChange={(e) => setStarts(e.target.value)}
          disabled={locked}
          error={starts && day && day !== "Sunday" ? `That is a ${day}. A season starts on a Sunday.` : null}
          hint={locked ? "The dates are fixed once tribes are approved or the season has begun." : undefined}
        />
        <Input label="Weeks" type="number" inputMode="numeric" min={4} max={24} value={weeks} onChange={(e) => setWeeks(e.target.value)} disabled={locked} />
      </div>
      {ends && day === "Sunday" ? <p className="t-small text-soft">It ends on Saturday {formatDate(ends)}.</p> : null}
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="md" loading={d.busy === "save"} disabled={name.trim().length < 3 || !starts}>
          {season ? "Save changes" : "Plan the season"}
        </Button>
      </div>
    </form>
  );
}
