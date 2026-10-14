import { STANDINGS, type Standing } from "./labels";
import type {
  Batch, CallbackRow, DirectoryPage, DirectoryPerson, Overview, PlanAction, PlanCounts, PlanRow, Preview, RefereeOpen, ReviewFlag, ReviewReferee, UnverifiedRow,
} from "./types";

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown): boolean => v === true;
const kind = (v: unknown): "email" | "phone" | null => (v === "email" || v === "phone" ? v : null);
const standing = (v: unknown): Standing => ((STANDINGS as readonly string[]).includes(str(v)) ? (str(v) as Standing) : "ministry_leader");

export function readDirectoryPage(data: unknown): DirectoryPage | null {
  const d = obj(data);
  if (!Array.isArray(d.rows)) return null;
  return {
    total: num(d.total),
    rows: arr(d.rows).map((r): DirectoryPerson => {
      const x = obj(r);
      return {
        id: str(x.id),
        name: str(x.name),
        standing: standing(x.standing),
        unit: strOrNull(x.unit),
        note: strOrNull(x.note),
        active: x.active !== false,
        updatedAt: strOrNull(x.updated_at),
        contacts: arr(x.contacts).map((c) => ({ kind: obj(c).kind === "email" ? ("email" as const) : ("phone" as const), value: str(obj(c).value) })),
      };
    }),
  };
}

const ACTIONS: PlanAction[] = ["add", "update", "revive", "unchanged", "retire", "error"];

export function readCounts(data: unknown): PlanCounts {
  const c = obj(data);
  return { add: num(c.add), update: num(c.update), unchanged: num(c.unchanged), retire: num(c.retire), error: num(c.error), total: num(c.total) };
}

export function readPlanRow(r: unknown): PlanRow {
  const x = obj(r);
  const action = ACTIONS.includes(x.action as PlanAction) ? (x.action as PlanAction) : "error";
  return {
    line: typeof x.line === "number" ? x.line : null,
    action,
    entryId: strOrNull(x.entry_id),
    name: str(x.name),
    standing: strOrNull(x.standing),
    unit: strOrNull(x.unit),
    contacts: arr(x.contacts).map(str).filter(Boolean),
    changes: arr(x.changes).map(str).filter(Boolean),
    warn: arr(x.warn).map(str).filter(Boolean),
    message: strOrNull(x.message),
  };
}

export function readPreview(data: unknown): Preview | null {
  const d = obj(data);
  if (!d.counts) return null;
  return { counts: readCounts(d.counts), activeNow: num(d.active_now), rows: arr(d.rows).map(readPlanRow) };
}

export function readBatches(data: unknown): Batch[] {
  return arr(data).map((b): Batch => {
    const x = obj(b);
    return {
      id: str(x.id),
      at: str(x.at),
      by: strOrNull(x.by),
      filename: strOrNull(x.filename),
      mode: x.mode === "replace" ? "replace" : "update",
      added: num(x.added),
      updated: num(x.updated),
      unchanged: num(x.unchanged),
      retired: num(x.retired),
      errors: num(x.errors),
      status: x.status === "undone" ? "undone" : "applied",
      canUndo: bool(x.can_undo),
    };
  });
}

export function readOverview(data: unknown): Overview | null {
  const d = obj(data);
  if (!d.settings || !d.directory) return null;
  const s = obj(d.settings);
  const dir = obj(d.directory);
  const refs = obj(d.references);
  return {
    settings: {
      gateStandings: arr(s.gate_standings).map(standing),
      callbackPct: num(s.callback_pct, 20),
      minSeconds: num(s.min_seconds, 40),
      codeMinutes: num(s.code_minutes, 10),
      maxTries: num(s.max_tries, 5),
      maxChanges: num(s.max_changes, 2),
    },
    directory: { active: num(dir.active), retired: num(dir.retired), pastor: num(dir.pastor), unitHead: num(dir.unit_head), ministryLeader: num(dir.ministry_leader), updatedAt: strOrNull(dir.updated_at) },
    references: { unverified: num(refs.unverified), asked: num(refs.asked), held: num(refs.held), toConfirm: num(refs.to_confirm) },
    callbacksOpen: num(d.callbacks_open),
  };
}

export function readUnverified(data: unknown): { total: number; rows: UnverifiedRow[] } {
  const d = obj(data);
  return {
    total: num(d.total),
    rows: arr(d.rows).map((r): UnverifiedRow => {
      const x = obj(r);
      return {
        id: str(x.id),
        applicationId: str(x.application_id),
        applicant: str(x.applicant),
        referee: str(x.referee),
        relationship: str(x.relationship),
        kind: kind(x.kind),
        masked: strOrNull(x.masked),
        answeredAt: strOrNull(x.answered_at),
        askedAt: strOrNull(x.asked_at),
        reachable: x.reachable !== false,
      };
    }),
  };
}

export function readCallbacks(data: unknown): CallbackRow[] {
  return arr(data).map((r): CallbackRow => {
    const x = obj(r);
    return {
      id: str(x.id),
      reason: x.reason === "flagged" || x.reason === "disowned" ? x.reason : "sample",
      dueOn: str(x.due_on),
      overdue: bool(x.overdue),
      attempts: num(x.attempts),
      referee: str(x.referee),
      relationship: str(x.relationship),
      contact: str(x.contact),
      kind: kind(x.kind),
      applicant: str(x.applicant),
      applicationId: str(x.application_id),
    };
  });
}

export function readReviewReferees(data: unknown): ReviewReferee[] {
  return arr(data).map((r): ReviewReferee => {
    const x = obj(r);
    const dir = obj(x.directory);
    const cb = obj(x.callback);
    const v = str(x.verification);
    return {
      id: str(x.id),
      slot: num(x.slot, 1),
      name: str(x.name),
      stage: str(x.stage) || "waiting",
      answered: bool(x.answered),
      verification: (["unverified", "contact", "directory", "pastor", "disputed"].includes(v) ? v : "unverified") as ReviewReferee["verification"],
      standing: bool(x.standing),
      claimedHead: bool(x.claimed_head),
      legacy: bool(x.legacy),
      verifiedAt: strOrNull(x.verified_at),
      verifiedKind: kind(x.verified_kind),
      reverifySent: bool(x.reverify_sent),
      reverified: bool(x.reverified),
      changes: num(x.changes),
      directory: x.directory ? { name: str(dir.name), standing: str(dir.standing), unit: strOrNull(dir.unit) } : null,
      held: bool(x.held),
      flags: arr(x.flags).map((f): ReviewFlag => {
        const y = obj(f);
        return {
          kind: str(y.kind),
          severity: y.severity === "note" ? "note" : "hold",
          detail: str(y.detail),
          cleared: bool(y.cleared),
          clearedBy: strOrNull(y.cleared_by),
          clearedNote: strOrNull(y.cleared_note),
        };
      }),
      callback: x.callback ? { status: str(cb.status), outcome: strOrNull(cb.outcome), reason: str(cb.reason), note: strOrNull(cb.note) } : null,
      confirmedBy: strOrNull(x.confirmed_by),
      confirmedNote: strOrNull(x.confirmed_note),
      canConfirm: bool(x.can_confirm),
      canClear: bool(x.can_clear),
    };
  });
}

export function readRefereeOpen(data: unknown): RefereeOpen {
  const d = obj(data);
  const state = str(d.state);
  if (!["open", "answered", "closed", "expired"].includes(state)) return { state: "invalid" };
  const code = obj(d.code);
  const who = obj(d.who);
  return {
    state: state as "open" | "answered" | "closed" | "expired",
    mode: d.mode === "reverify" ? "reverify" : "give",
    applicant: str(d.applicant) || "the applicant",
    referee: str(d.referee),
    relationship: str(d.relationship),
    kind: d.kind === "phone" ? "phone" : "email",
    masked: strOrNull(d.masked),
    verified: bool(d.verified),
    who: d.who ? { name: str(who.name), standing: str(who.standing), unit: strOrNull(who.unit) } : null,
    code: {
      live: bool(code.live),
      failed: bool(code.failed),
      wait: num(code.wait),
      lockedMinutes: num(code.locked_minutes),
      triesLeft: num(code.tries_left, 5),
      minutes: num(code.minutes, 10),
    },
  };
}
