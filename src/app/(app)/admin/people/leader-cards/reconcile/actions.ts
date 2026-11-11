"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { LEADER_CARD_ACT_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { HOD_MAX_BYTES, HOD_MAX_ROWS, readHodSheet, readHodText, type HodProblem, type HodRow } from "@/lib/leader-cards/hod";

const PAGES = ["/admin/people/leader-cards/reconcile", "/admin/people/leader-cards"];

type Fail = { ok: false; message: string };
const NOT_AVAILABLE: Fail = { ok: false, message: "That page is not available." };

/** The office (admin, director, pastor) may make and act on a report; the database checks again on every call. */
async function mayAct(): Promise<boolean> {
  const session = await getSession();
  return !!session && hasAnyRole(session.roles, LEADER_CARD_ACT_ROLES);
}

export type HodReadResult = { ok: true; rows: HodRow[]; problems: HodProblem[] } | Fail;

/** Reads the list that was uploaded or pasted. Nothing is saved: the office sees what was understood first. */
export async function readHodAction(formData: FormData): Promise<HodReadResult> {
  if (!(await mayAct())) return NOT_AVAILABLE;
  const file = formData.get("file");
  const pasted = formData.get("text");
  let read;
  if (file instanceof File && file.size > 0) {
    if (file.size > HOD_MAX_BYTES) return { ok: false, message: "That file is too large. A list of up to 500 people is well under 2 MB." };
    read = readHodSheet(file.name, Buffer.from(await file.arrayBuffer()));
  } else if (typeof pasted === "string" && pasted.trim()) {
    read = readHodText(pasted.slice(0, HOD_MAX_BYTES));
  } else {
    return { ok: false, message: "Choose a file, or paste the list." };
  }
  return read.ok ? { ok: true, rows: read.rows, problems: read.problems.slice(0, 100) } : read;
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** Makes the report from the rows that were read. Nothing is sent and nobody is changed. */
export async function makeHodReportAction(rows: HodRow[], note: string): Promise<{ ok: true; id: string } | Fail> {
  if (!(await mayAct())) return NOT_AVAILABLE;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: "Read the list first." };
  if (rows.length > HOD_MAX_ROWS) return { ok: false, message: `Use up to ${HOD_MAX_ROWS} people at a time.` };
  const sheet = rows.map((r, i) => ({
    line: Number.isInteger(r?.line) && r.line >= 1 ? r.line : i + 1,
    name: clip(r?.name, 120),
    email: clip(r?.email, 200),
    phone: clip(r?.phone, 40),
    department: clip(r?.department, 60),
    goal: clip(r?.goal, 120),
  }));
  const done = (await run("hod_reconcile_run", { p_rows: sheet, p_note: clip(note, 200) }, PAGES)) as Done<{ id?: string } | null>;
  if (!done.ok) return done;
  const id = done.data?.id;
  return isUuid(id) ? { ok: true, id } : { ok: false, message: TRY_AGAIN };
}

/** Puts the department on the list on each appointed leader who has none. */
export async function tagHodAction(id: string): Promise<Done<{ tagged: number; differs: number }>> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const done = (await run("hod_reconcile_tag", { p_run: id }, PAGES)) as Done<{ tagged?: number; differs?: number } | null>;
  return done.ok ? { ok: true, data: { tagged: Number(done.data?.tagged ?? 0), differs: Number(done.data?.differs ?? 0) } } : done;
}

/** Sends the leader invitation to each person with no account who gave an email address. Once for a report. */
export async function inviteHodAction(id: string): Promise<Done<{ invited: number }>> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const done = (await run("hod_reconcile_invite", { p_run: id }, PAGES)) as Done<{ invited?: number } | null>;
  return done.ok ? { ok: true, data: { invited: Number(done.data?.invited ?? 0) } } : done;
}

/** Deletes the report and the contacts it holds. */
export async function deleteHodAction(id: string): Promise<Done> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return run("hod_reconcile_delete", { p_run: id }, PAGES);
}
