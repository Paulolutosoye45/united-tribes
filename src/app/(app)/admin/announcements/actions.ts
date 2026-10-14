"use server";

import { run, plain, type Done, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import type { AudiencePreview, AudienceSample, AudienceSpec } from "@/lib/outreach/types";

const PAGES = ["/admin/announcements", "/admin/announcements/approvals", "/admin"];

const isSpec = (v: unknown): v is AudienceSpec => Boolean(v) && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string";

export type DraftFields = {
  title: string;
  audience: AudienceSpec;
  audience_label: string;
  subject: string;
  paragraphs: string[];
  button_label: string | null;
  button_target: string | null;
};

function cleanFields(f: DraftFields): DraftFields | null {
  if (!f || typeof f !== "object" || !isSpec(f.audience)) return null;
  const paragraphs = Array.isArray(f.paragraphs) ? f.paragraphs.filter((p) => typeof p === "string").slice(0, 8) : [];
  return {
    title: String(f.title ?? "").slice(0, 120),
    audience: f.audience,
    audience_label: String(f.audience_label ?? "").slice(0, 160),
    subject: String(f.subject ?? "").slice(0, 160),
    paragraphs: paragraphs.map((p) => p.slice(0, 1200)),
    button_label: f.button_label ? String(f.button_label).slice(0, 40) : null,
    button_target: f.button_target ? String(f.button_target) : null,
  };
}

/** Live counts for a rule. Never names, only how many, and how many are left out and why. */
export async function previewAudienceAction(spec: AudienceSpec): Promise<Done<AudiencePreview>> {
  if (!isSpec(spec)) return { ok: false, message: TRY_AGAIN };
  return run<AudiencePreview>("audience_preview", { p_spec: spec });
}

/** One person as they will read it, so the writer sees real names, tribes and dates. */
export async function sampleAudienceAction(spec: AudienceSpec, index: number): Promise<Done<AudienceSample>> {
  if (!isSpec(spec) || !Number.isInteger(index) || index < 0 || index > 100000) return { ok: false, message: TRY_AGAIN };
  return run<AudienceSample>("audience_sample", { p_spec: spec, p_n: index });
}

/** Starts or changes a draft. The wording is checked as it is saved. */
export async function saveBroadcastAction(id: string | null, fields: DraftFields): Promise<Done<string>> {
  const clean = cleanFields(fields);
  if (!clean || (id !== null && !isUuid(id))) return { ok: false, message: TRY_AGAIN };
  return run<string>("broadcast_save", { p_id: id, p_fields: clean }, PAGES);
}

/** Sends it for approval when it needs a second person, otherwise schedules it. `at` is a time inside the sending hours, or null for as soon as it may go. */
export async function submitBroadcastAction(id: string, at: string | null): Promise<Done<{ status: string; count: number }>> {
  if (!isUuid(id) || (at !== null && Number.isNaN(Date.parse(at)))) return { ok: false, message: TRY_AGAIN };
  return run<{ status: string; count: number }>("broadcast_submit", { p_id: id, p_send_at: at }, PAGES);
}

/** Sends the email to the writer only, to see it in a real inbox. */
export async function testBroadcastAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("broadcast_test_send", { p_id: id }));
}

export async function approveBroadcastAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("broadcast_approve", { p_id: id }, PAGES));
}

export async function rejectBroadcastAction(id: string, note: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("broadcast_reject", { p_id: id, p_note: String(note ?? "").slice(0, 300) }, PAGES));
}

export async function controlBroadcastAction(id: string, what: "pause" | "resume" | "cancel"): Promise<Result> {
  if (!isUuid(id) || !["pause", "resume", "cancel"].includes(what)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("broadcast_control", { p_id: id, p_action: what }, PAGES));
}

export async function saveAudienceAction(name: string, spec: AudienceSpec, label: string): Promise<Done<string>> {
  if (!isSpec(spec)) return { ok: false, message: TRY_AGAIN };
  return run<string>("audience_save", { p_name: String(name ?? "").slice(0, 80), p_spec: spec, p_label: String(label ?? "").slice(0, 160) }, PAGES);
}

export async function deleteAudienceAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("audience_delete", { p_id: id }, PAGES));
}
