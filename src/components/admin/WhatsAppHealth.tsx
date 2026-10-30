"use client";

import { runWhatsappChecksAction, sendWhatsappTestAction } from "@/app/(app)/admin/messages/whatsapp/actions";
import { Button } from "@/components/ui/Button";
import { whenText } from "@/lib/signin/admin";
import type { HealthItem, HealthState } from "@/lib/whatsapp/health";
import { causeWords, receiptWords, signalWords, testWords, type HealthView } from "@/lib/whatsapp/health-view";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const BADGE: Record<HealthState, { label: string; tone: string }> = {
  good: { label: "Working", tone: "bg-success/15 text-success" },
  warn: { label: "Look at this", tone: "bg-gold/25 text-ink" },
  bad: { label: "Needs fixing", tone: "bg-flame/15 text-flame-deep" },
  unknown: { label: "Not known", tone: "bg-surface-strong text-ink" },
};

function Row({ item }: { item: HealthItem }) {
  const b = BADGE[item.state];
  return (
    <li className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0" data-testid={`wa-check-${item.key}`} data-state={item.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{item.title}</p>
        <span className={`rounded-full px-3 py-1 text-[0.85rem] font-semibold ${b.tone}`}>{b.label}</span>
      </div>
      <p className="t-small">{item.words}</p>
      {item.fix ? <p className="t-small text-soft">{item.fix}</p> : null}
      {item.list && item.list.length > 0 ? (
        <ul className="t-small list-disc pl-5 text-soft">
          {item.list.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Is WhatsApp working, and if not, why: the checks Meta answered, the last week, the news Meta sent, and a test message. */
export function WhatsAppHealth({ view }: { view: HealthView }) {
  const d = useDo();
  const report = view.check?.report ?? null;
  const receipts = receiptWords(view);
  const rb = BADGE[receipts.state];
  const test = view.test ? testWords(view.test) : null;
  const week = view.week;
  const outcomes = [
    ["Reached the person", week.reached],
    ["Read", week.read],
    ["Sent, receipt not due yet", week.waiting],
    [`Sent, no receipt after ${view.unconfirmedHours} hours`, week.silent],
    ["Waiting to go out", week.inQueue],
  ] as const;
  const gave = view.movedOn.reduce((n, x) => n + x.n, 0);

  return (
    <div className="flex flex-col gap-8">
      {view.paused ? (
        <p role="note" className="t-small rounded-[var(--radius-control)] bg-flame/10 px-4 py-3" data-testid="wa-health-paused">
          WhatsApp is paused for everyone. Members are being reached by email and text. The test message below still goes through, so you can try the account before restarting it on the Message log page.
        </p>
      ) : null}

      <section aria-labelledby="wa-checks-heading" className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="wa-checks">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="wa-checks-heading" className="t-heading">
              Asking Meta
            </h2>
            <p className="t-small max-w-[60ch] text-soft">
              {view.check
                ? `Last asked ${whenText(view.check.at)}${view.check.by ? ` by ${view.check.by}` : ""}.`
                : "Nobody has asked yet. This asks Meta whether the access token works, how the sending number stands, whether the site hears back, and whether every message has approved wording."}
            </p>
          </div>
          {view.canCheck ? (
            <Button size="md" loading={d.busy === "check"} onClick={() => void d.go("check", () => runWhatsappChecksAction(), { saved: "Done. The answers are below." })}>
              {view.check ? "Check again" : "Check now"}
            </Button>
          ) : null}
        </div>
        {report ? (
          <>
            <p className="font-semibold" data-testid="wa-checks-summary">
              {report.ok ? "Nothing is stopping WhatsApp." : "Something needs fixing before WhatsApp can be trusted."}
            </p>
            <ul className="divide-y divide-line">
              {report.items.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </ul>
          </>
        ) : view.check ? (
          <p className="t-small text-soft">The last answer could not be read. Check again.</p>
        ) : null}
      </section>

      <section aria-labelledby="wa-week-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="wa-week">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="wa-week-heading" className="t-heading">
            The last seven days
          </h2>
          <span className={`rounded-full px-3 py-1 text-[0.85rem] font-semibold ${rb.tone}`} data-testid="wa-receipts-state" data-state={receipts.state}>
            {receipts.state === "good" ? "Receipts coming back" : receipts.state === "unknown" ? "No receipts yet" : "Receipts missing"}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {outcomes.map(([label, n]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="t-small text-soft">{label}</dt>
              <dd className="text-xl font-semibold">{n}</dd>
            </div>
          ))}
        </dl>
        <p className="t-small">{receipts.words}</p>
        {receipts.fix ? <p className="t-small text-soft">{receipts.fix}</p> : null}
        {view.lastReceiptAt || view.lastSentAt ? (
          <p className="t-small text-soft">
            {view.lastSentAt ? `Last sent ${whenText(view.lastSentAt)}. ` : ""}
            {view.lastReceiptAt ? `Last receipt ${whenText(view.lastReceiptAt)}.` : ""}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="font-semibold">Given up on WhatsApp, and why</p>
          {gave === 0 ? (
            <p className="t-small text-soft">Nothing, in the last seven days{view.countedSince ? ` (counted since ${whenText(view.countedSince)})` : ""}.</p>
          ) : (
            <>
              <p className="t-small text-soft">
                {gave} {gave === 1 ? "message" : "messages"} went to email or text instead, if the person had agreed to it
                {view.countedSince ? `. Counted since ${whenText(view.countedSince)}.` : "."}
              </p>
              <ul className="flex flex-col gap-2" data-testid="wa-moved">
                {view.movedOn.map((x) => {
                  const w = causeWords(x.cause);
                  return (
                    <li key={x.cause} className="t-small">
                      <span className="font-semibold">{x.n}</span> · {w.label}
                      <span className="block text-soft">{w.fix}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      {view.signals.length > 0 ? (
        <section aria-labelledby="wa-signals-heading" className="card flex flex-col gap-3 p-5 sm:p-6" data-testid="wa-signals">
          <h2 id="wa-signals-heading" className="t-heading">
            What Meta has told the site
          </h2>
          <ul className="t-small flex flex-col gap-2">
            {view.signals.map((s) => (
              <li key={`${s.kind}-${s.subject}-${s.at}`}>
                <span className="text-soft">{whenText(s.at)}</span> · {signalWords(s)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="wa-test-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="wa-test">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="wa-test-heading" className="t-heading">
              Send me a test message
            </h2>
            <p className="t-small max-w-[60ch] text-soft">Sends one short message on WhatsApp to the phone number saved on your own profile. It is the surest way to see that everything works from the site to your phone.</p>
          </div>
          {view.canTest ? (
            <Button size="md" variant="quiet" loading={d.busy === "test"} onClick={() => void d.go("test", () => sendWhatsappTestAction(), { saved: "Queued. Look at your phone in a minute or two, and refresh this page." })}>
              Send me a test message
            </Button>
          ) : null}
        </div>
        {!view.canTest ? (
          <p className="t-small text-soft">{view.canCheck ? "Save your own phone number on your profile first. The test goes to the number saved there." : "Only the admin, a director or the data lead can send a test."}</p>
        ) : null}
        {test ? (
          <p className="t-small" data-testid="wa-test-status" data-state={test.state}>
            <span className="font-semibold">Your last test, {view.test ? whenText(view.test.at) : ""}:</span> {test.words}
          </p>
        ) : null}
      </section>

      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
