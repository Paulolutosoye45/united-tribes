"use client";

import { useState } from "react";
import { departmentAction, resendAction, type Resent } from "@/app/(app)/admin/people/leader-cards/actions";
import { markHandAction, openStaffChatAction } from "@/app/(app)/admin/messages/by-hand/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CARD_WORDS, HOW_WORDS, agoWords, bulkTargets, canResend, inviteLine, skipWords, type Board, type BoardRow } from "@/lib/leader-cards/cards";

const field = "h-11 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";

const STATE_TONE = { not_started: "flame", in_progress: "gold", changes_asked: "gold", submitted: "neutral", approved: "charcoal" } as const;

/** The first line a WhatsApp chat is opened with when the email did not arrive. */
const chatText = (first: string, tribe: string) =>
  `Hi ${first}, this is the church office. We tried to email you the link to your Tribe Card for ${tribe}, and it may not have reached you. Could you tell us the best email address to use? Then we will send it again.`;

/** The Leader cards board: one card for each leader, with the words for where it is and buttons to send the email again. */
export function LeaderCardsBoard({ board }: { board: Board }) {
  const d = useDo();
  const act = board.role === "act";
  const targets = bulkTargets(board.rows);
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState<Resent | null>(null);
  const [chat, setChat] = useState<{ key: string; log: number; link: string; first: string } | null>(null);

  const send = (person: string | null, key: string) =>
    void d.go(
      key,
      async () => {
        const r = await resendAction(person);
        if (!r.ok) return r;
        setSent(r.data);
        setConfirm(false);
        return { ok: true as const };
      },
      {},
    );

  return (
    <div className="flex flex-col gap-4" data-testid="lc-board">
      {act && targets.length > 0 ? (
        <section className="card flex flex-col gap-3 p-4 sm:p-5" aria-label="Send the email again to everyone it did not reach">
          <p className="t-body">
            <strong data-testid="lc-bulk-count">{targets.length}</strong> {targets.length === 1 ? "leader has" : "leaders have"} not started and {targets.length === 1 ? "their" : "their"} email did not arrive.
          </p>
          {confirm ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="t-small">Send the email with the link again to these {targets.length}? Nobody is written to twice in a day, and each leader is sent it at most three times.</span>
              <Button size="md" variant="primary" loading={d.busy === "all"} onClick={() => send(null, "all")} data-testid="lc-bulk-confirm">
                Yes, send it again
              </Button>
              <Button size="md" variant="ghost" onClick={() => setConfirm(false)}>
                Not now
              </Button>
            </div>
          ) : (
            <div>
              <Button size="md" variant="quiet" onClick={() => setConfirm(true)} data-testid="lc-bulk">
                Send it again to everyone it did not reach
              </Button>
            </div>
          )}
        </section>
      ) : null}

      {sent ? (
        <p role="status" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="lc-sent">
          {sent.queued === 0 ? "Nothing was sent." : `${sent.queued} ${sent.queued === 1 ? "email is" : "emails are"} on its way.`}
          {sent.skipped.length > 0 ? ` Left out: ${sent.skipped.map((s) => `${s.name} (${skipWords(s.reason).toLowerCase()})`).join(", ")}.` : ""}
        </p>
      ) : null}
      <Notice error={d.error} saved={d.saved} />

      {board.rows.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="lc-empty">
          Nobody matches.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="lc-list">
          {board.rows.map((r) => (
            <Row key={r.personId} r={r} act={act} departments={board.departments} d={d} send={send} chat={chat} setChat={setChat} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  r, act, departments, d, send, chat, setChat,
}: {
  r: BoardRow;
  act: boolean;
  departments: string[];
  d: ReturnType<typeof useDo>;
  send: (person: string | null, key: string) => void;
  chat: { key: string; log: number; link: string; first: string } | null;
  setChat: (v: { key: string; log: number; link: string; first: string } | null) => void;
}) {
  const [dept, setDept] = useState(r.department ?? "");
  const first = r.name.split(" ")[0] ?? r.name;
  const failed = r.invite.state === "failed" || r.invite.state === "not_sent";
  return (
    <li className="card flex flex-col gap-3 p-4 sm:p-5" data-testid={`lc-row-${r.personId}`} data-state={r.state} data-invite={r.invite.state}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{r.name}</span>
          <span className="t-small text-soft">
            {r.tribe} · {HOW_WORDS[r.how] ?? r.how}
          </span>
        </div>
        <Badge tone={STATE_TONE[r.state]}>{CARD_WORDS[r.state]}</Badge>
      </div>

      <dl className="t-small grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-soft">Email with the link</dt>
          <dd data-testid={`lc-invite-${r.personId}`} className={failed ? "font-medium text-danger" : ""}>
            {inviteLine(r)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-soft">Signed in</dt>
          <dd>{r.signedIn ? "Yes" : "Never"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-soft">Last did something</dt>
          <dd>{agoWords(r.lastActivity)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-soft">Reminded</dt>
          <dd>{r.reminders + r.resends === 0 ? "Not yet" : `${r.reminders + r.resends} ${r.reminders + r.resends === 1 ? "time" : "times"}`}</dd>
        </div>
        {act && r.email ? (
          <div className="flex gap-2 sm:col-span-2">
            <dt className="text-soft">Address on file</dt>
            <dd className="break-all" data-testid={`lc-address-${r.personId}`}>{r.email}</dd>
          </div>
        ) : null}
      </dl>

      {act ? (
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex min-w-0 flex-1 items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void d.go(`dept-${r.personId}`, () => departmentAction(r.personId, dept), { saved: dept.trim() ? `${r.name} is in ${dept.trim()}.` : `${r.name} has no department.` });
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[0.85rem] font-medium">
              Department
              <input
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                list="lc-departments"
                maxLength={60}
                placeholder="For example Ushers"
                className={field}
                data-testid={`lc-dept-${r.personId}`}
              />
            </label>
            <Button type="submit" size="sm" variant="ghost" loading={d.busy === `dept-${r.personId}`} disabled={dept.trim() === (r.department ?? "")}>
              Save
            </Button>
          </form>
          {canResend(r) ? (
            <Button size="sm" variant={failed ? "solid" : "quiet"} loading={d.busy === r.personId} onClick={() => send(r.personId, r.personId)} data-testid={`lc-resend-${r.personId}`}>
              Send the email again
            </Button>
          ) : null}
          {failed && r.canChat ? (
            <Button
              size="sm"
              variant="ghost"
              loading={d.busy === `chat-${r.personId}`}
              data-testid={`lc-chat-${r.personId}`}
              onClick={() =>
                void d.go(`chat-${r.personId}`, async () => {
                  const o = await openStaffChatAction(r.personId, "leader_note", chatText(first, r.tribe));
                  if (!o.ok) return o;
                  setChat({ key: r.personId, log: o.data.log, link: o.data.link, first: o.data.first });
                  window.open(o.data.link, "_blank", "noopener,noreferrer");
                  return { ok: true as const };
                })
              }
            >
              Message {first} on WhatsApp
            </Button>
          ) : null}
        </div>
      ) : null}

      {chat?.key === r.personId ? (
        <div className="pop-in flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface-strong px-4 py-3" data-testid="lc-chat-opened">
          <p className="t-small">
            WhatsApp should have opened for {chat.first}. If it did not,{" "}
            <a href={chat.link} target="_blank" rel="noopener noreferrer" className="underline">
              open it here
            </a>
            . Did you send it?
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="sm" variant="solid" onClick={() => void d.go("mark", () => markHandAction(chat.log, "sent").then((x) => (x.ok ? { ok: true as const } : x)), { saved: "Marked as sent.", after: () => setChat(null) })}>
              Yes, I sent it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void d.go("mark", () => markHandAction(chat.log, "skipped").then((x) => (x.ok ? { ok: true as const } : x)), { saved: "Noted: left.", after: () => setChat(null) })}>
              I left it
            </Button>
          </div>
        </div>
      ) : null}

      <datalist id="lc-departments">
        {departments.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    </li>
  );
}
