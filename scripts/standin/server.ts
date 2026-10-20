/**
 * A stand-in for the two Supabase services this app uses, for local work and
 * for the browser tests: sign-in (email code) and the data API, running on a
 * real Postgres that has every migration applied.
 *
 * It is NOT Supabase and must never face the internet:
 *  - it listens on 127.0.0.1 only,
 *  - the sign-in code is always 123456,
 *  - it understands only the part of the data API this app uses.
 *
 * Row level security is real, because every request runs inside Postgres as the
 * `anon` or `authenticated` role with the person's id set, exactly as Supabase
 * does it. Google sign-in is not available here.
 */
import crypto from "node:crypto";
import http from "node:http";
import { Pool, type PoolClient } from "pg";
import { signWebhook } from "../../src/lib/whatsapp/webhook";

export type StandinOptions = {
  port: number;
  pg: { host: string; port: number; user: string; password: string; database: string };
  jwtSecret: string;
  /** The code that signs anyone in. */
  code?: string;
  /** Roles to give a person the first time they sign in, by email. */
  rolesFor?: (email: string) => string[];
  /**
   * Like Supabase Auth with CAPTCHA protection switched on: a request for a sign-in code is refused unless it carries a
   * bot-check token that starts with this text. Every token seen is listed at GET /__captcha.
   */
  captchaPrefix?: string;
  /**
   * Like Supabase Auth with a "Send SMS" hook configured: instead of sending a text, it calls this address, signed the
   * way Supabase signs its hooks, with the person and the code. A reply that is not a success makes the request fail
   * as it does there ("Error sending sms"). Without it, a phone code request just answers success and sends nothing.
   */
  smsHook?: { url: string; secret: string };
};

type Json = Record<string, unknown>;
class HttpError extends Error {
  constructor(
    public status: number,
    public body: Json,
  ) {
    super(String(body.message ?? body.msg ?? "error"));
  }
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new HttpError(400, { code: "PGRST100", message: `Bad name: ${name}`, details: null, hint: null });
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

function sign(payload: Json, secret: string): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verify(token: string, secret: string): Json | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Json;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function anonKey(secret: string): string {
  return sign({ role: "anon", iss: "standin", iat: 1700000000, exp: 4102444800 }, secret);
}

// ---------------------------------------------------------------------------
// The data API: reading what the browser asks for
// ---------------------------------------------------------------------------

type Node = { kind: "col"; name: string; alias?: string } | { kind: "star" } | { kind: "embed"; alias?: string; table: string; children: Node[] };

function splitTop(source: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let current = "";
  for (const ch of source) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === sep) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseSelect(source: string): Node[] {
  return splitTop(source).map((item): Node => {
    if (item === "*") return { kind: "star" };
    const open = item.indexOf("(");
    if (open > 0 && item.endsWith(")")) {
      const head = item.slice(0, open).replace(/!.*$/, "");
      const [alias, table] = head.includes(":") ? head.split(":") : [undefined, head];
      return { kind: "embed", alias, table, children: parseSelect(item.slice(open + 1, -1)) };
    }
    const [alias, name] = item.includes(":") ? item.split(":") : [undefined, item];
    return { kind: "col", name: name.replace(/::.*$/, ""), alias };
  });
}

type Fk = { child: string; childCol: string; parent: string; parentCol: string };

function selectSql(table: string, alias: string, nodes: Node[], fks: Fk[], depth: number): string {
  const items: string[] = [];
  for (const n of nodes) {
    if (n.kind === "star") items.push(`${alias}.*`);
    else if (n.kind === "col") items.push(`${alias}.${ident(n.name)}${n.alias ? ` as ${ident(n.alias)}` : ""}`);
    else {
      const e = `e${depth}`;
      const x = `x${depth}`;
      const label = ident(n.alias ?? n.table);
      const toOne = fks.find((f) => f.child === table && f.parent === n.table);
      const toMany = fks.find((f) => f.child === n.table && f.parent === table);
      const inner = selectSql(n.table, e, n.children, fks, depth + 1);
      if (toOne) {
        items.push(`(select to_json(${x}) from (select ${inner} from public.${ident(n.table)} ${e} where ${e}.${ident(toOne.parentCol)} = ${alias}.${ident(toOne.childCol)}) ${x}) as ${label}`);
      } else if (toMany) {
        items.push(`(select coalesce(json_agg(${x}), '[]'::json) from (select ${inner} from public.${ident(n.table)} ${e} where ${e}.${ident(toMany.childCol)} = ${alias}.${ident(toMany.parentCol)}) ${x}) as ${label}`);
      } else {
        throw new HttpError(400, { code: "PGRST200", message: `No relationship between ${table} and ${n.table}`, details: null, hint: null });
      }
    }
  }
  return items.join(", ");
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

function parseList(value: string): string[] {
  const inner = value.replace(/^\(/, "").replace(/\)$/, "");
  return splitTop(inner).map((v) => v.replace(/^"(.*)"$/, "$1"));
}

function whereSql(params: URLSearchParams, alias: string, values: unknown[]): string {
  const parts: string[] = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    const col = `${alias}.${ident(key)}`;
    let not = false;
    let rest = raw;
    if (rest.startsWith("not.")) {
      not = true;
      rest = rest.slice(4);
    }
    const dot = rest.indexOf(".");
    const op = rest.slice(0, dot);
    const value = rest.slice(dot + 1);
    let sql: string;
    if (op === "is") {
      sql = value === "null" ? `${col} is null` : value === "true" ? `${col} is true` : value === "false" ? `${col} is false` : "";
      if (!sql) throw new HttpError(400, { code: "PGRST100", message: "Unsupported is filter", details: null, hint: null });
    } else if (op === "in") {
      values.push(parseList(value));
      sql = `${col} = any($${values.length})`;
    } else if (OPS[op]) {
      values.push(value);
      sql = `${col} ${OPS[op]} $${values.length}`;
    } else {
      throw new HttpError(400, { code: "PGRST100", message: `Unsupported filter: ${key}=${raw}`, details: null, hint: null });
    }
    parts.push(not ? `not (${sql})` : sql);
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

function orderSql(order: string | null, alias: string): string {
  if (!order) return "";
  const parts = splitTop(order).map((item) => {
    const [col, ...mods] = item.split(".");
    const dir = mods.includes("desc") ? "desc" : "asc";
    const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
    return `${alias}.${ident(col)} ${dir}${nulls}`;
  });
  return ` order by ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export async function startStandin(options: StandinOptions): Promise<{ close: () => Promise<void>; anonKey: string; url: string }> {
  const code = options.code ?? "123456";
  const pool = new Pool({ ...options.pg, max: 8 });
  const refreshTokens = new Map<string, string>();
  /** The sign-in session a refresh token belongs to. Like Supabase, a refreshed token stays in the same session. */
  const refreshSessions = new Map<string, string>();

  const fkRows = await pool.query(`
    select c.relname as child, ca.attname as "childCol", p.relname as parent, pa.attname as "parentCol"
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_class p on p.oid = con.confrelid
      join pg_attribute ca on ca.attrelid = con.conrelid and ca.attnum = con.conkey[1]
      join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
     where con.contype = 'f' and array_length(con.conkey, 1) = 1 and con.connamespace = 'public'::regnamespace`);
  const fks = fkRows.rows as Fk[];

  async function inRole<T>(claims: Json | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const role = claims?.role === "authenticated" ? "authenticated" : "anon";
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [String(claims?.sub ?? ""), JSON.stringify(claims ?? {})]);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ----------------------------------------------------------------- auth
  type UserRow = { id: string; email: string; phone: string | null; created_at: Date; email_confirmed_at: Date | null };
  /** Numbers waiting for their code, by account (the "add a WhatsApp number" flow). */
  const pendingPhones = new Map<string, string>();
  async function userRow(email: string) {
    const found = await pool.query("select id, email, phone, created_at, email_confirmed_at from auth.users where email = $1", [email]);
    return found.rows[0] as UserRow | undefined;
  }

  async function ensureUser(email: string) {
    let row = await userRow(email);
    if (!row) {
      await pool.query("insert into auth.users (email, email_confirmed_at) values ($1, now())", [email]);
      row = await userRow(email);
      for (const role of options.rolesFor?.(email) ?? []) {
        await pool.query(
          `insert into public.person_roles (person_id, role, centre_id) select $1, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing`,
          [row!.id, role],
        );
      }
    }
    return row!;
  }

  function userJson(row: { id: string; email: string; phone?: string | null; created_at: Date }) {
    return {
      id: row.id,
      aud: "authenticated",
      role: "authenticated",
      email: row.email,
      email_confirmed_at: new Date().toISOString(),
      phone: row.phone ?? "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: row.created_at.toISOString(),
      updated_at: new Date().toISOString(),
      is_anonymous: false,
    };
  }

  function sessionFor(row: { id: string; email: string; phone?: string | null; created_at: Date }, session: string = crypto.randomUUID()) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;
    const access = sign(
      { aud: "authenticated", role: "authenticated", sub: row.id, email: row.email, phone: row.phone ?? "", iat: now, exp, session_id: session, app_metadata: { provider: "email" }, user_metadata: {}, is_anonymous: false },
      options.jwtSecret,
    );
    const refresh = crypto.randomBytes(18).toString("base64url");
    refreshTokens.set(refresh, row.id);
    refreshSessions.set(refresh, session);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userJson(row) };
  }

  const bearerClaims = (req: http.IncomingMessage): Json | null => {
    const header = String(req.headers.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return token ? verify(token, options.jwtSecret) : null;
  };

  const captchaSeen: { path: string; token: string | null }[] = [];

  /** The "Send SMS" hook: tell it who the code is for and what it is. `newPhone` is set when a number is being added or changed. */
  async function runSmsHook(user: { id: string; phone: string | null }, newPhone?: string) {
    const hook = options.smsHook;
    if (!hook) return;
    const payload = JSON.stringify({
      user: { id: user.id, phone: (user.phone ?? "").replace(/\D/g, ""), ...(newPhone ? { new_phone: newPhone.replace(/\D/g, "") } : {}) },
      sms: { otp: code },
    });
    const id = `msg_${crypto.randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    let ok = false;
    try {
      const response = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signWebhook(hook.secret, id, timestamp, payload) },
        body: payload,
      });
      ok = response.ok;
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(500, { code: 500, error_code: "sms_send_failed", msg: "Error sending sms" });
  }

  async function handleAuth(req: http.IncomingMessage, path: string, url: URL, body: Json): Promise<{ status: number; body?: unknown }> {
    if (path === "/otp" && req.method === "POST") {
      const meta = body.gotrue_meta_security as { captcha_token?: unknown } | undefined;
      const token = typeof meta?.captcha_token === "string" && meta.captcha_token ? meta.captcha_token : null;
      captchaSeen.push({ path, token });
      if (options.captchaPrefix && !(token && token.startsWith(options.captchaPrefix))) {
        throw new HttpError(400, { code: 400, error_code: "captcha_failed", msg: "captcha verification process failed" });
      }
    }
    if (path === "/otp" && req.method === "POST" && body.phone) {
      // Like the real service with shouldCreateUser off: an unknown number gets an error the app treats as "sent".
      const digits = String(body.phone).replace(/\D/g, "");
      const known = await pool.query("select id, phone from auth.users where regexp_replace(phone, '\\D', '', 'g') = $1", [digits]);
      if (known.rows[0]) await runSmsHook(known.rows[0] as { id: string; phone: string | null });
      return { status: 200, body: {} };
    }
    if (path === "/otp" && req.method === "POST") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(422, { code: 422, error_code: "validation_failed", msg: "Unable to validate email address: invalid format" });
      await ensureUser(email);
      return { status: 200, body: {} };
    }
    if (path === "/verify" && req.method === "POST" && body.phone) {
      if (String(body.token ?? "") !== code) throw new HttpError(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      const phone = String(body.phone).replace(/\D/g, "");
      if (body.type === "phone_change") {
        // Like the real service, the number itself finds the account that is waiting to add it: this request carries no session.
        const owner = [...pendingPhones.entries()].find(([, wanted]) => wanted.replace(/\D/g, "") === phone)?.[0];
        if (!owner) throw new HttpError(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
        await pool.query("update auth.users set phone = $2, phone_confirmed_at = now() where id = $1", [owner, phone]);
        pendingPhones.delete(owner);
        const row = (await pool.query("select id, email, phone, created_at, email_confirmed_at from auth.users where id = $1", [owner])).rows[0] as UserRow;
        return { status: 200, body: sessionFor(row) };
      }
      const found = await pool.query("select id, email, phone, created_at, email_confirmed_at from auth.users where regexp_replace(phone, '\\D', '', 'g') = $1", [phone]);
      if (!found.rows[0]) throw new HttpError(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return { status: 200, body: sessionFor(found.rows[0]) };
    }
    if (path === "/user" && req.method === "PUT") {
      const claims = bearerClaims(req);
      if (!claims?.sub) throw new HttpError(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      if (body.phone) pendingPhones.set(String(claims.sub), String(body.phone));
      const found = await pool.query("select id, email, phone, created_at from auth.users where id = $1", [claims.sub]);
      if (body.phone && found.rows[0]) await runSmsHook(found.rows[0] as { id: string; phone: string | null }, String(body.phone));
      return { status: 200, body: { ...userJson(found.rows[0]), phone_change: body.phone ? String(body.phone) : undefined } };
    }
    if (path === "/verify" && req.method === "POST") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (String(body.token ?? "") !== code) throw new HttpError(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      const row = await userRow(email);
      if (!row) throw new HttpError(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return { status: 200, body: sessionFor(row) };
    }
    if (path === "/token" && req.method === "POST" && url.searchParams.get("grant_type") === "refresh_token") {
      const id = refreshTokens.get(String(body.refresh_token ?? ""));
      const found = id ? await pool.query("select id, email, phone, created_at from auth.users where id = $1", [id]) : null;
      if (!found || !found.rows[0]) throw new HttpError(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
      const session = refreshSessions.get(String(body.refresh_token));
      refreshTokens.delete(String(body.refresh_token));
      refreshSessions.delete(String(body.refresh_token));
      return { status: 200, body: sessionFor(found.rows[0], session) };
    }
    if (path === "/user" && req.method === "GET") {
      const claims = bearerClaims(req);
      if (!claims?.sub) throw new HttpError(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const found = await pool.query("select id, email, phone, created_at from auth.users where id = $1", [claims.sub]);
      if (!found.rows[0]) throw new HttpError(403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
      return { status: 200, body: userJson(found.rows[0]) };
    }
    if (path === "/logout") return { status: 204 };
    if (path === "/.well-known/jwks.json") return { status: 200, body: { keys: [] } };
    if (path === "/authorize") throw new HttpError(501, { code: 501, msg: "Google sign-in is not available in the stand-in. Use the email code." });
    throw new HttpError(404, { code: 404, msg: `No such auth route: ${path}` });
  }

  // ----------------------------------------------------------------- rest
  async function handleRest(req: http.IncomingMessage, path: string, url: URL, body: unknown): Promise<{ status: number; body?: unknown; headers?: Record<string, string> }> {
    const claims = bearerClaims(req);
    const prefer = String(req.headers.prefer ?? "");
    const wantRows = prefer.includes("return=representation");
    const single = String(req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");

    if (path.startsWith("/rpc/")) {
      const fn = path.slice(5);
      const args = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Json;
      return inRole(claims, async (c) => {
        const meta = await c.query(
          `select p.proretset, p.prorettype::regtype::text as ret, p.proargnames as names,
                  (select array_agg(format_type(t, null) order by i) from unnest(p.proargtypes::oid[]) with ordinality as u(t, i)) as types
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
          [fn],
        );
        const row = meta.rows.find((m) => Object.keys(args).every((k) => (m.names ?? []).includes(k))) ?? null;
        if (!row) throw new HttpError(404, { code: "PGRST202", message: `Could not find the function public.${fn}`, details: null, hint: null });
        const params: unknown[] = [];
        const list = Object.entries(args).map(([k, v]) => {
          const type = row.types[(row.names as string[]).indexOf(k)] as string;
          params.push(type === "jsonb" || type === "json" ? JSON.stringify(v) : v);
          return `${ident(k)} => $${params.length}::${type}`;
        });
        const call = `public.${ident(fn)}(${list.join(", ")})`;
        if (row.ret === "void") {
          await c.query(`select ${call}`, params);
          return { status: 204 };
        }
        if (row.proretset) {
          const out = await c.query(`select coalesce(json_agg(t), '[]'::json) as r from ${call} t`, params);
          return { status: 200, body: out.rows[0].r };
        }
        const out = await c.query(`select to_json(${call}) as r`, params);
        return { status: 200, body: out.rows[0].r };
      });
    }

    const table = path.slice(1);
    const select = parseSelect(url.searchParams.get("select") ?? "*");
    const method = req.method ?? "GET";

    return inRole(claims, async (c) => {
      const values: unknown[] = [];
      const t = ident(table);
      let source: string;

      if (method === "GET") {
        const limit = url.searchParams.get("limit");
        const offset = url.searchParams.get("offset");
        const filter = whereSql(url.searchParams, "b", values);
        const sql = `select coalesce(json_agg(q), '[]'::json) as r from (select ${selectSql(table, "b", select, fks, 0)} from public.${t} b${filter}${orderSql(url.searchParams.get("order"), "b")}${limit ? ` limit ${Math.max(0, Number(limit) | 0)}` : ""}${offset ? ` offset ${Math.max(0, Number(offset) | 0)}` : ""}) q`;
        return shape((await c.query(sql, values)).rows[0].r as unknown[], 200);
      }

      if (method === "POST") {
        const rows = (Array.isArray(body) ? body : [body]) as Json[];
        if (rows.length === 0 || rows.some((r) => !r || typeof r !== "object")) throw new HttpError(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null });
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const colList = cols.map(ident).join(", ");
        const conflict = url.searchParams.get("on_conflict");
        let tail = "";
        if (conflict && prefer.includes("resolution=merge-duplicates")) {
          const keys = conflict.split(",").map(ident).join(", ");
          const sets = cols.filter((k) => !conflict.split(",").includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`);
          tail = sets.length ? ` on conflict (${keys}) do update set ${sets.join(", ")}` : ` on conflict (${keys}) do nothing`;
        } else if (prefer.includes("resolution=ignore-duplicates")) tail = " on conflict do nothing";
        values.push(JSON.stringify(rows));
        source = `insert into public.${t} (${colList}) select ${colList} from json_populate_recordset(null::public.${t}, $1::json)${tail} returning *`;
        return finish(c, source, values, 201);
      }

      if (method === "PATCH") {
        const patch = (body ?? {}) as Json;
        const cols = Object.keys(patch);
        if (cols.length === 0) throw new HttpError(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null });
        values.push(JSON.stringify(patch));
        const sets = cols.map((k) => `${ident(k)} = r.${ident(k)}`).join(", ");
        const filter = whereSql(url.searchParams, `public.${t}`, values);
        source = `update public.${t} set ${sets} from json_populate_record(null::public.${t}, $1::json) r${filter} returning public.${t}.*`;
        return finish(c, source, values, 200);
      }

      if (method === "DELETE") {
        const filter = whereSql(url.searchParams, `public.${t}`, values);
        source = `delete from public.${t}${filter} returning public.${t}.*`;
        return finish(c, source, values, 200);
      }

      throw new HttpError(405, { code: "PGRST101", message: "Method not allowed", details: null, hint: null });

      function shape(rows: unknown[], status: number) {
        if (single) {
          if (rows.length !== 1) throw new HttpError(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
          return { status, body: rows[0] };
        }
        return { status, body: rows, headers: { "content-range": rows.length ? `0-${rows.length - 1}/*` : "*/*" } };
      }

      async function finish(client: PoolClient, sql: string, params: unknown[], status: number) {
        if (!wantRows && !single) {
          await client.query(sql, params);
          return { status: status === 201 ? 201 : 204 };
        }
        const out = await client.query(`with changed as (${sql}) select coalesce(json_agg(q), '[]'::json) as r from (select ${selectSql(table, "b", select, fks, 0)} from changed b) q`, params);
        return shape(out.rows[0].r as unknown[], status);
      }
    });
  }

  // ----------------------------------------------------------------- http
  const server = http.createServer((req, res) => {
    const origin = String(req.headers.origin ?? "*");
    const cors: Record<string, string> = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept, accept-profile, content-profile, range",
      "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "access-control-expose-headers": "content-range",
      vary: "origin",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", "http://stand.in");
          const raw = Buffer.concat(chunks).toString("utf8");
          let body: unknown = {};
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              throw new HttpError(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null });
            }
          }
          let result: { status: number; body?: unknown; headers?: Record<string, string> };
          if (url.pathname === "/__captcha") result = { status: 200, body: captchaSeen };
          else if (url.pathname.startsWith("/auth/v1")) result = await handleAuth(req, url.pathname.slice(8), url, (body ?? {}) as Json);
          else if (url.pathname.startsWith("/rest/v1")) result = await handleRest(req, url.pathname.slice(8), url, body);
          else throw new HttpError(404, { message: "Not found" });
          const text = result.body === undefined ? "" : JSON.stringify(result.body);
          res.writeHead(result.status, { ...cors, ...(result.headers ?? {}), ...(text ? { "content-type": "application/json" } : {}) });
          res.end(text);
        } catch (error) {
          let status = 500;
          let payload: Json = { message: "Stand-in error" };
          if (error instanceof HttpError) {
            status = error.status;
            payload = error.body;
          } else if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
            const e = error as { code: string; message: string; detail?: string; hint?: string };
            payload = { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null };
            status = e.code === "42501" ? 403 : e.code === "23505" || e.code === "23503" ? 409 : e.code === "42883" || e.code === "42P01" ? 404 : 400;
          } else console.error("stand-in:", error);
          res.writeHead(status, { ...cors, "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        }
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${options.port}`,
    anonKey: anonKey(options.jwtSecret),
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  };
}
