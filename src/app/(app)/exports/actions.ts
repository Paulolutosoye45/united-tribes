"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { isPackId, parseFeedLinks, parsePrepared } from "@/lib/exports/parse";
import { FEED_TABLES, type FeedLink, type FeedTable } from "@/lib/exports/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

const FORMATS = ["xlsx", "csv", "pdf"];
const PURPOSES = ["pastoral_care", "planning", "reporting"];

export type Prepared = { ok: true; exportId: string; token: string; expiresAt: string; rehearsal: boolean; format: string } | Fail;

/**
 * Asks the database for a private link to a file. The database checks the person, the pack's position, the format and the choices
 * and says in words what is wrong; nothing is built here. The link is shown once: only its fingerprint is kept.
 */
export async function prepareAction(input: { pack: string; format: string; purpose?: string | null; tribe?: string | null; community?: string | null; season?: string | null }): Promise<Prepared> {
  if (!input || !isPackId(input.pack) || !FORMATS.includes(input.format)) return bad();
  if (input.purpose && !PURPOSES.includes(input.purpose)) return bad();
  const filters: Record<string, string> = {};
  for (const key of ["tribe", "community", "season"] as const) {
    const v = input[key];
    if (v) {
      if (!isUuid(v)) return bad();
      filters[key] = v;
    }
  }
  const done = (await run("export_prepare", { p_pack: input.pack, p_format: input.format, p_purpose: input.purpose || null, p_filters: filters }, ["/exports/mine"])) as Done<unknown>;
  if (!done.ok) return done;
  const p = parsePrepared(done.data);
  return p ? { ok: true, exportId: p.export_id, token: p.token, expiresAt: p.expires_at, rehearsal: p.rehearsal, format: input.format } : bad();
}

/** Delete now: the link stops working at once. Nothing is stored, so there is no file to remove. */
export async function withdrawAction(exportId: string): Promise<{ ok: true } | Fail> {
  if (!isUuid(exportId)) return bad();
  const done = await run("export_withdraw", { p_export: exportId }, ["/exports/mine", "/exports"]);
  return done.ok ? { ok: true } : done;
}

export type FeedMade = { ok: true; id: string; token: string; table: FeedTable; expiresAt: string } | Fail;

/** Makes a standing link. The address is shown once. The database refuses unless the pack and this way in are switched on. */
export async function feedCreateAction(table: string, label: string): Promise<FeedMade> {
  if (!(FEED_TABLES as string[]).includes(table) || typeof label !== "string") return bad();
  const done = (await run("export_feed_create", { p_table: table, p_label: label.slice(0, 80) }, ["/exports/feeds"])) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  if (typeof d.token !== "string" || !/^[a-f0-9]{64}$/.test(d.token) || typeof d.id !== "string") return bad();
  return { ok: true, id: d.id, token: d.token, table: table as FeedTable, expiresAt: typeof d.expires_at === "string" ? d.expires_at : "" };
}

export async function feedRenewAction(id: string): Promise<{ ok: true; links: FeedLink[] } | Fail> {
  if (!isUuid(id)) return bad();
  const done = await run("export_feed_renew", { p_id: id }, ["/exports/feeds"]);
  return done.ok ? { ok: true, links: parseFeedLinks(done.data) } : done;
}

export async function feedRevokeAction(id: string): Promise<{ ok: true } | Fail> {
  if (!isUuid(id)) return bad();
  const done = await run("export_feed_revoke", { p_id: id }, ["/exports/feeds"]);
  return done.ok ? { ok: true } : done;
}
