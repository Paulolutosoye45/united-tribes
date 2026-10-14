import { NextResponse } from "next/server";
import { isLinkToken } from "@/lib/outreach/link";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * The unsubscribe button that Gmail, Apple Mail and Outlook show above an email (RFC 8058). The mail program calls this by
 * itself with a POST, so one tap ends it with no page and no questions. The address is only ever called with the long
 * secret from that one email, and it ends only the kind of email that email was.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const secret = workerToken();
  if (!isLinkToken(token)) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });
  if (!secret) return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  const { data, error } = await workerRpc(secret)("worker_unsubscribe_oneclick", { p_link: token });
  if (error) return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ ok: data === true }, { status: data === true ? 200 : 410, headers: NO_STORE });
}

/**
 * Someone following the link by hand, or a scanner that fetches every link, only ever lands on the page that asks them to
 * confirm. Fetching it never unsubscribes anybody.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const target = isLinkToken(token) ? new URL(`/e/${token}`, request.url) : new URL("/", request.url);
  return NextResponse.redirect(target, { status: 303, headers: NO_STORE });
}
