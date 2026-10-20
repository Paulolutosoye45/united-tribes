import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Badge } from "@/components/ui/Badge";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { templateTitle, wordingOf } from "@/lib/god/message-text";
import { CHANNEL_WORDS, MESSAGE_STATUSES, STATUS_WORDS, contextWords, isUuid, replyLine } from "@/lib/god/oversight";
import { loadAnnouncements, loadChatOpens, loadMessages, loadPerson, markLooked } from "@/lib/god/server";
import { ago, clock, roleWords } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Conversations" };

type SearchParams = Promise<{ view?: string; person?: string; status?: string; before?: string }>;
const VIEWS = [
  { id: "messages", label: "Messages sent" },
  { id: "chats", label: "Chats opened" },
  { id: "announcements", label: "Announcements" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const when = (iso: string, now: number) => ago(iso, now) || `${formatLagosDay(iso)}, ${formatLagosTime(iso)}`;
const tone = (status: string) => (status === "failed" ? "flame" : status === "read" || status === "delivered" ? "gold" : "outline");

function href(view: View, extra: Record<string, string | null | undefined> = {}) {
  const q = new URLSearchParams();
  if (view !== "messages") q.set("view", view);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return `/god/conversations${s ? `?${s}` : ""}`;
}

export default async function ConversationsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.id === sp.view) ? (sp.view as View) : "messages";
  const person = isUuid(sp.person) ? sp.person : null;
  const status = (MESSAGE_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as string) : null;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
  const supabase = await createClient();
  const now = clock();

  const who = person ? await loadPerson(supabase, person) : null;
  const whoName = who ? (who.person.full_name ?? who.person.preferred_name ?? who.person.email) : null;
  await markLooked(supabase, view === "chats" ? "chat_opens" : person ? "person_conversation" : "conversations", view === "chats" ? null : person);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">{whoName ? `Conversations with ${whoName}` : "Conversations"}</h1>
        <p className="t-body measure text-soft">
          What the platform has said to people, how it went, the answers that came back, and the chats staff opened on WhatsApp.
        </p>
        <p className="t-small measure rounded-[var(--radius-control)] bg-surface px-4 py-3" data-testid="chat-note">
          The platform does not keep free-text chat. People talk to each other on WhatsApp, where we cannot see the words. We keep who opened a chat with whom, and when; the messages we sent, with their wording; and the answers that came back as a button or STOP.
          The wording of care and safeguarding messages, requests for help, referee and guardian links, and anything sent to a young member is never shown. Codes and links are always taken out.
        </p>
      </header>

      <nav aria-label="Conversations" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={href(v.id, { person: v.id === "announcements" ? null : person })}
            aria-current={view === v.id ? "page" : undefined}
            className={`press rounded-full px-4 py-2 text-[0.92rem] font-medium ${view === v.id ? "bg-ink text-page" : "border border-line text-soft hover:text-ink"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {person && view !== "announcements" ? (
        <p className="t-small text-soft">
          Showing {whoName ?? "one person"} only.{" "}
          <Link href={href(view)} className="underline">
            Show everyone
          </Link>{" "}
          ·{" "}
          <Link href={`/god/people/${person}`} className="underline">
            Open their page
          </Link>
        </p>
      ) : null}

      {view === "messages" ? <MessagesView supabase={supabase} person={person} status={status} before={before} now={now} /> : null}
      {view === "chats" ? <ChatsView supabase={supabase} person={person} now={now} /> : null}
      {view === "announcements" ? <AnnouncementsView supabase={supabase} now={now} /> : null}
    </div>
  );
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function MessagesView({ supabase, person, status, before, now }: { supabase: Client; person: string | null; status: string | null; before: string | null; now: number }) {
  const r = await loadMessages(supabase, { person, status, before, limit: 40 });
  if (!r) return <p className="card t-body p-6 text-soft">The messages could not load. Try again in a moment.</p>;
  const last = r.messages.length > 0 ? r.messages[r.messages.length - 1] : null;

  return (
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        {person ? <input type="hidden" name="person" value={person} /> : null}
        <label className="flex flex-col gap-1">
          <span className="t-small font-semibold">How it went</span>
          <select name="status" defaultValue={status ?? ""} className="input h-11">
            <option value="">All</option>
            {MESSAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_WORDS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-quiet h-11 rounded-[var(--radius-control)] px-5 font-medium">
          Show
        </button>
      </form>

      {person && r.replies.length > 0 ? (
        <section aria-labelledby="replies-heading" className="card flex flex-col gap-2 p-5" data-testid="replies">
          <h2 id="replies-heading" className="t-heading">
            Their answers
          </h2>
          <ul className="flex flex-col gap-1">
            {r.replies.map((x, i) => (
              <li key={i} className="t-body flex flex-wrap justify-between gap-x-4">
                <span>{replyLine(x)}</span>
                <span className="t-small text-soft">{when(x.at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {r.messages.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="no-messages">
          {status ? `No ${STATUS_WORDS[status].toLowerCase()} messages${person ? " for this person" : ""}.` : "Nothing has been sent."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="message-list">
          {r.messages.map((m) => {
            const words = wordingOf(m);
            return (
              <li key={m.id} className="card flex flex-col gap-2 p-4 sm:p-5" data-message={m.template} data-status={m.status}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {m.personId ? (
                    <Link href={href("messages", { person: m.personId })} className="font-semibold underline">
                      {m.name}
                    </Link>
                  ) : (
                    <span className="font-semibold">{m.name}</span>
                  )}
                  {m.roles.length > 0 ? <Badge tone="outline">{roleWords(m.roles)}</Badge> : null}
                  <span className="t-small text-soft">{templateTitle(m.template)}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {m.urgent ? <Badge tone="flame">Urgent</Badge> : null}
                    <Badge tone={tone(m.status)}>{STATUS_WORDS[m.status] ?? m.status}</Badge>
                  </span>
                </div>
                <p className="t-small text-soft">
                  {m.channel ? CHANNEL_WORDS[m.channel] ?? m.channel : "No channel chosen yet"} · {when(m.sentAt ?? m.at, now)}
                </p>
                {m.error ? <p className="t-small text-danger">{m.error}</p> : null}
                {m.held ? (
                  <p className="t-small rounded-[var(--radius-control)] bg-surface px-3 py-2" data-testid="held">
                    {m.held}
                  </p>
                ) : words ? (
                  <details>
                    <summary className="t-small cursor-pointer">
                      <span className="font-semibold">{words.subject}</span> <span className="text-soft">· read the message</span>
                    </summary>
                    <p className="t-body mt-2 whitespace-pre-line text-soft">{words.text}</p>
                  </details>
                ) : (
                  <p className="t-small text-soft">The wording is not available for this message.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {r.more && last ? (
        <p>
          <Link href={href("messages", { person, status, before: last.at })} className="btn btn-quiet inline-flex h-11 items-center rounded-[var(--radius-control)] px-5 font-medium" data-testid="older">
            Older messages
          </Link>
        </p>
      ) : null}
    </div>
  );
}

async function ChatsView({ supabase, person, now }: { supabase: Client; person: string | null; now: number }) {
  const r = await loadChatOpens(supabase, person);
  if (!r) return <p className="card t-body p-6 text-soft">The chats could not load. Try again in a moment.</p>;
  return (
    <section aria-label="Chats opened" className="flex flex-col gap-3">
      <p className="t-small text-soft">
        {r.total.toLocaleString("en-NG")} {r.total === 1 ? "chat" : "chats"} opened{person ? " with or by this person" : ""}. Each is a staff member choosing “Message on WhatsApp”. The words happen in WhatsApp.
      </p>
      {r.opens.length === 0 ? (
        <p className="card t-body p-6 text-soft">No chat has been opened.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden" data-testid="chat-list">
          {r.opens.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="t-body">
                {c.openedBy ? (
                  <Link href={`/god/people/${c.openedBy}`} className="font-semibold underline">
                    {c.openedByName ?? "A staff member"}
                  </Link>
                ) : (
                  <span className="font-semibold">A staff member</span>
                )}
                {c.openedByRoles.length > 0 ? <span className="t-small text-soft"> ({roleWords(c.openedByRoles)})</span> : null} opened a chat with{" "}
                {c.personId ? (
                  <Link href={href("chats", { person: c.personId })} className="font-semibold underline">
                    {c.personName ?? "someone"}
                  </Link>
                ) : (
                  <span className="font-semibold">someone who has since been erased</span>
                )}
                <span className="t-small text-soft"> · {contextWords(c.context)}</span>
              </span>
              <span className="t-small text-soft">{when(c.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function AnnouncementsView({ supabase, now }: { supabase: Client; now: number }) {
  const list = await loadAnnouncements(supabase);
  return (
    <section aria-label="Announcements" className="flex flex-col gap-3">
      <p className="t-small text-soft">What the church has announced to everyone or to a group, written by the office.</p>
      {list.length === 0 ? (
        <p className="card t-body p-6 text-soft">No announcement has been made.</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="announcement-list">
          {list.map((a) => (
            <li key={a.id} className="card flex flex-col gap-1 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{a.title}</span>
                <Badge tone="outline">{a.status.replace(/_/g, " ")}</Badge>
                {a.audience ? <span className="t-small text-soft">to {a.audience}</span> : null}
              </div>
              {a.subject ? <p className="t-body text-soft">{a.subject}</p> : null}
              <p className="t-small text-soft">
                {a.reached.toLocaleString("en-NG")} reached · {when(a.at, now)}
                {a.by ? ` · by ${a.by}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
