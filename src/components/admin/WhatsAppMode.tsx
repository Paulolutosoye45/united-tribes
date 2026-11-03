"use client";

import Link from "next/link";
import { useState } from "react";
import { addWhatsappRateAction, saveWhatsappSettingsAction, setMessageClassAction, setWhatsappModeAction } from "@/app/(app)/admin/messages/whatsapp-mode/actions";
import { Button } from "@/components/ui/Button";
import { templateName } from "@/lib/admin/wording";
import { whenText } from "@/lib/signin/admin";
import { CLASS_WORDS, type MessageClass } from "@/lib/whatsapp/classes";
import { HOUR_WORDS, LOG_KIND_WORDS, MODE_WORDS, changedWords, modeHeadline, monthWords, usd, usdSmall, type ModeName, type ModeView } from "@/lib/whatsapp/mode-view";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

const TONE = { good: "bg-success/15 text-success", warn: "bg-flame/15 text-flame-deep", quiet: "bg-surface-strong text-ink" } as const;
const field = "h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none";
const MODES: ModeName[] = ["full", "saver", "free"];

/** WhatsApp mode: how the church uses WhatsApp (Full, Saver or Free), what the month has cost so far, and the settings behind it. */
export function WhatsAppMode({ view }: { view: ModeView }) {
  const d = useDo();
  const head = modeHeadline(view);
  const [pick, setPick] = useState<ModeName | null>(null);
  const [reason, setReason] = useState("");
  const [settings, setSettings] = useState(false);

  return (
    <div className="flex flex-col gap-8" data-testid="wa-mode">
      <section aria-labelledby="wa-mode-heading" className="card flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="wa-mode-heading" className="t-heading">
              How the church uses WhatsApp
            </h2>
            <p className="t-small max-w-[64ch] text-soft" data-testid="wa-mode-line">
              {head.line}
            </p>
          </div>
          <span data-testid="wa-mode-now" className={`rounded-full px-4 py-1.5 font-semibold ${TONE[head.tone]}`}>
            {head.word}
          </span>
        </div>

        {view.paused ? (
          <p role="note" className="t-small rounded-[var(--radius-control)] bg-flame/10 px-4 py-3" data-testid="wa-mode-paused">
            WhatsApp is paused (see Message log). While it is paused every message goes by email or text, whatever mode is chosen.
          </p>
        ) : null}

        {changedWords(view, whenText) ? (
          <p className="t-small text-soft" data-testid="wa-mode-changed">
            {changedWords(view, whenText)}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="WhatsApp mode">
          {MODES.map((m) => {
            const chosen = (pick ?? view.chosen) === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={!view.canChange}
                data-testid={`wa-mode-choose-${m}`}
                onClick={() => setPick(m)}
                className={`flex flex-col gap-1.5 rounded-[var(--radius-control)] border-[1.5px] p-4 text-left transition-colors ${chosen ? "border-ink bg-surface-strong" : "border-line bg-raised"} disabled:cursor-default`}
              >
                <span className="flex items-center justify-between gap-2 font-semibold">
                  {MODE_WORDS[m].name}
                  {view.chosen === m ? <span className="t-small font-medium text-soft">Chosen now</span> : null}
                </span>
                <span className="t-small">{MODE_WORDS[m].line}</span>
                <span className="t-small text-soft">{MODE_WORDS[m].costs}</span>
              </button>
            );
          })}
        </div>

        {view.canChange && pick && pick !== view.chosen ? (
          <div className="pop-in flex flex-col gap-3">
            <label htmlFor="wa-mode-reason" className="t-small font-medium">
              Why are you changing to {MODE_WORDS[pick].name}? (a few words; it goes in the log)
            </label>
            <input id="wa-mode-reason" data-testid="wa-mode-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={field} />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="solid"
                size="md"
                data-testid="wa-mode-apply"
                loading={d.busy === "mode"}
                disabled={reason.trim().length < 5}
                onClick={() => void d.go("mode", () => setWhatsappModeAction(pick, reason.trim()), { saved: `WhatsApp mode is now ${MODE_WORDS[pick].name}.`, after: () => { setPick(null); setReason(""); } })}
              >
                Use {MODE_WORDS[pick].name}
              </Button>
              <Button variant="ghost" size="md" onClick={() => { setPick(null); setReason(""); }}>
                Not now
              </Button>
            </div>
          </div>
        ) : null}
        {!view.canChange ? <p className="t-small text-soft">Only the admin, a director or the data lead can change the mode.</p> : null}
        {view.state === "on" && view.guard === "on" && view.chosen === "free" ? (
          <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="wa-mode-free-note">
            In Free mode the website sends no request to Meta, so the account is not checked, the test message is not sent, and WhatsApp sign-in codes work only on the ordinary-number route. Leaders send WhatsApp by hand from the Lead page.
          </p>
        ) : null}
        <Notice error={d.error} saved={d.saved} />
      </section>

      <section aria-labelledby="wa-mode-month" className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="wa-mode-month" className="t-heading">
          The month so far
        </h2>
        <p className="t-body" data-testid="wa-mode-monthline">
          {monthWords(view.month, view.settings.ceilingUsd, whenText)}
        </p>
        <p className="t-small text-soft">
          This is an estimate from the rates below, which are the church&rsquo;s own figures. It is never Meta&rsquo;s invoice.{" "}
          <Link href="/admin/messages/whatsapp-cost" className="underline">
            The cost page
          </Link>{" "}
          shows it message by message.
        </p>
      </section>

      <section aria-labelledby="wa-mode-week" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="wa-mode-week">
        <h2 id="wa-mode-week" className="t-heading">
          What each mode would have done to the last seven days
        </h2>
        <p className="t-small text-soft">
          {view.week.total} WhatsApp {view.week.total === 1 ? "message" : "messages"} went out. {view.week.a} must reach, {view.week.b} are the weekly rhythm, {view.week.c} are email-is-enough.
        </p>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="t-small text-soft">Full</dt>
            <dd className="font-semibold">{view.week.total} by WhatsApp · about {usd(view.week.usd)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="t-small text-soft">Saver</dt>
            <dd className="font-semibold">
              {view.week.a} by WhatsApp · {view.week.b + view.week.c} by email · saves about {usd(view.week.usdBC)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="t-small text-soft">Free</dt>
            <dd className="font-semibold">0 by WhatsApp · saves about {usd(view.week.usd)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="wa-mode-settings" className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="wa-mode-settings" className="t-heading">
            Protecting the number
          </h2>
          {view.canChange && !settings ? (
            <Button variant="ghost" size="md" onClick={() => setSettings(true)}>
              Change the numbers
            </Button>
          ) : null}
        </div>
        {settings ? <SettingsForm view={view} done={() => setSettings(false)} /> : <SettingsSummary view={view} />}
      </section>

      <Classes view={view} />
      <Rates view={view} />

      {view.hand.opened > 0 ? (
        <p className="t-small text-soft" data-testid="wa-mode-hand">
          Sent by hand in the last seven days: {view.hand.opened} chats or group posts opened, {view.hand.sent} marked sent, {view.hand.skipped} left.{" "}
          <Link href="/admin/messages/by-hand" className="underline">
            Message a leader by hand
          </Link>
        </p>
      ) : (
        <p className="t-small text-soft">
          <Link href="/admin/messages/by-hand" className="underline">
            Message a leader by hand
          </Link>{" "}
          · for leaders and coaches who said yes to WhatsApp.
        </p>
      )}

      {view.log.length > 0 ? (
        <details className="card p-5 sm:p-6">
          <summary className="t-small cursor-pointer font-medium">What happened lately</summary>
          <ul className="t-small mt-3 flex flex-col gap-2" data-testid="wa-mode-log">
            {view.log.map((l, i) => (
              <li key={`${l.at}-${i}`}>
                <span className="text-soft">{whenText(l.at)}</span> · {LOG_KIND_WORDS[l.kind] ?? l.kind}
                {l.kind === "mode" && l.to ? ` to ${MODE_WORDS[l.to as ModeName]?.name ?? l.to}` : ""}
                {l.by ? ` (${l.by})` : l.kind.startsWith("ceiling") || l.kind.startsWith("quality") ? " (by itself)" : ""}
                {l.reason ? `: ${l.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SettingsSummary({ view }: { view: ModeView }) {
  const s = view.settings;
  return (
    <dl className="grid gap-3 sm:grid-cols-2" data-testid="wa-mode-settings-view">
      <Item label="Monthly ceiling" value={s.ceilingUsd ? `${usd(s.ceilingUsd)}. A warning at ${s.warnPct}%; Full drops to Saver at the ceiling, once a month.` : "None. Nothing drops by itself."} />
      <Item label="Most messages an hour" value={`${s.pacePerHour}. The weekly rhythm waits for the next hour when it is full; messages that must reach never wait.`} />
      <Item label="Most different people a day" value={`${s.reachPct}% of what Meta lets the number start talking to. Past that, a message goes by email, or waits until tomorrow if that is all the person has.`} />
      <Item label="Weekly rhythm to one person" value={`No more than ${s.weeklyCap} a week; the rest go by email. Messages that must reach are never counted.`} />
      <Item label="Hours for the weekly rhythm" value={s.windowFrom === 0 && s.windowTo === 24 ? "Any hour (the night-time quiet hours still apply)." : `${HOUR_WORDS(s.windowFrom)} to ${HOUR_WORDS(s.windowTo)}`} />
      <Item label="If Meta rates the number" value={s.qualityGuard ? "Medium: Full drops to Saver. Low: WhatsApp pauses itself. A person puts it back." : "The quality guard is off: Meta's rating changes nothing here."} />
    </dl>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="t-small text-soft">{label}</dt>
      <dd className="t-small">{value}</dd>
    </div>
  );
}

function SettingsForm({ view, done }: { view: ModeView; done: () => void }) {
  const d = useDo();
  const s = view.settings;
  const [ceiling, setCeiling] = useState(s.ceilingUsd ? String(s.ceilingUsd) : "");
  const [warn, setWarn] = useState(String(s.warnPct));
  const [pace, setPace] = useState(String(s.pacePerHour));
  const [reach, setReach] = useState(String(s.reachPct));
  const [cap, setCap] = useState(String(s.weeklyCap));
  const [from, setFrom] = useState(String(s.windowFrom));
  const [to, setTo] = useState(String(s.windowTo));
  const [guard, setGuard] = useState(s.qualityGuard);
  return (
    <form
      className="pop-in flex flex-col gap-4"
      data-testid="wa-mode-settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go(
          "settings",
          () =>
            saveWhatsappSettingsAction({
              ceilingUsd: ceiling.trim() === "" ? null : Number(ceiling),
              warnPct: Number(warn),
              pacePerHour: Number(pace),
              reachPct: Number(reach),
              weeklyCap: Number(cap),
              windowFrom: Number(from),
              windowTo: Number(to),
              qualityGuard: guard,
            }),
          { saved: "Saved.", after: done },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="Monthly ceiling in US dollars (empty for none)">
          <input inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} className={field} data-testid="wa-set-ceiling" />
        </Label>
        <Label text="Warn at this percentage of it (10–100)">
          <input inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} className={field} />
        </Label>
        <Label text="Most messages an hour (10–5000)">
          <input inputMode="numeric" value={pace} onChange={(e) => setPace(e.target.value)} className={field} />
        </Label>
        <Label text="Most different people a day, as a percentage of Meta's limit (10–100)">
          <input inputMode="numeric" value={reach} onChange={(e) => setReach(e.target.value)} className={field} />
        </Label>
        <Label text="Weekly-rhythm messages to one person in a week (1–14)">
          <input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className={field} />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label text="Weekly rhythm from hour (0–23)">
            <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          </Label>
          <Label text="until hour (1–24)">
            <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </Label>
        </div>
      </div>
      <label className="flex items-center gap-3 text-[0.95rem] font-medium">
        <input type="checkbox" checked={guard} onChange={(e) => setGuard(e.target.checked)} className="h-5 w-5" />
        Drop to Saver, or pause, when Meta rates the number Medium or Low
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="solid" size="md" loading={d.busy === "settings"}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={done}>
          Cancel
        </Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </form>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
      {text}
      {children}
    </label>
  );
}

function Classes({ view }: { view: ModeView }) {
  const d = useDo();
  const groups: MessageClass[] = ["A", "B", "C"];
  return (
    <section aria-labelledby="wa-mode-classes" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="wa-mode-classes">
      <h2 id="wa-mode-classes" className="t-heading">
        Which messages must reach
      </h2>
      <p className="t-small text-soft">
        In Saver, class A stays on WhatsApp and B and C go by email. Free ignores the classes. A person with no other way to be reached still gets a B or C message by WhatsApp in Saver. Meta files some wording as Marketing, which costs more: those are kept off WhatsApp whatever the class.
      </p>
      <Notice error={d.error} saved={d.saved} />
      {groups.map((g) => {
        const rows = view.classes.filter((c) => c.class === g);
        return (
          <details key={g} open={g === "A"} className="border-t border-line pt-3">
            <summary className="cursor-pointer font-medium">
              {CLASS_WORDS[g].name} ({g}) · {rows.length}
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.template} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="t-small">
                    {templateName(r.template)}
                    {view.marketing.includes(r.template) ? <span className="ml-2 text-flame-deep">filed by Meta as Marketing</span> : null}
                  </span>
                  {view.canChange ? (
                    <select
                      aria-label={`Class of ${templateName(r.template)}`}
                      data-testid={`wa-class-${r.template}`}
                      value={r.class}
                      disabled={d.busy !== null}
                      onChange={(e) => void d.go(r.template, () => setMessageClassAction(r.template, e.target.value), { saved: `${templateName(r.template)} is now class ${e.target.value}.` })}
                      className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-2 text-[0.95rem]"
                    >
                      {groups.map((x) => (
                        <option key={x} value={x}>
                          {CLASS_WORDS[x].name} ({x})
                        </option>
                      ))}
                    </select>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

function Rates({ view }: { view: ModeView }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("utility");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  return (
    <section aria-labelledby="wa-mode-rates" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="wa-mode-rates">
      <h2 id="wa-mode-rates" className="t-heading">
        What Meta charges
      </h2>
      <p className="t-small text-soft">
        These are the church&rsquo;s own figures, read from Meta&rsquo;s rate card for Nigeria and typed in here. The site never asks Meta for prices. The newest one that has started is used. Whether the church qualifies for any nonprofit rate is for the church to ask Meta.
      </p>
      <ul className="t-small flex flex-col gap-1">
        {view.rates.map((r, i) => (
          <li key={`${r.category}-${r.effectiveOn}-${i}`}>
            {r.category === "marketing" ? "Marketing" : "Utility"}: {usdSmall(r.usd)} a message from {r.effectiveOn}
            {r.source ? ` (${r.source})` : ""}
          </li>
        ))}
      </ul>
      {view.canChange ? (
        open ? (
          <form
            className="pop-in flex flex-col gap-3"
            data-testid="wa-rate-form"
            onSubmit={(e) => {
              e.preventDefault();
              void d.go("rate", () => addWhatsappRateAction(category, Number(price), date, source), { saved: "Rate saved.", after: () => { setOpen(false); setPrice(""); setDate(""); setSource(""); } });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Label text="Category">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                  <option value="utility">Utility</option>
                  <option value="marketing">Marketing</option>
                </select>
              </Label>
              <Label text="US dollars a message">
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={field} data-testid="wa-rate-price" />
              </Label>
              <Label text="Starts on">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} data-testid="wa-rate-date" />
              </Label>
              <Label text="Where it is from (optional)">
                <input value={source} maxLength={120} onChange={(e) => setSource(e.target.value)} className={field} />
              </Label>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="solid" size="md" loading={d.busy === "rate"} disabled={!price || !date}>
                Save the rate
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="ghost" size="md" onClick={() => setOpen(true)}>
              Enter a new rate
            </Button>
          </div>
        )
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
