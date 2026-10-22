"use client";

import { useState } from "react";
import { welcomeApproveAction, welcomeSaveAction, welcomeWithdrawAction } from "@/app/(app)/god/appointments/choose-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/dates";
import { WELCOME_APPROVE_HELP, type WelcomeSettings } from "@/lib/god/goal-unlock";

type Preview = { variant: "choose" | "fixed"; subject: string; html: string; text: string };

/**
 * The welcome email: both versions as they would be written today, the two lines under it, and the approval. No welcome email is sent
 * until the pastor's wording is approved here, and changing the name or title takes the approval away again.
 */
export function WelcomePanel({
  settings,
  version,
  previews,
  modes,
}: {
  settings: WelcomeSettings;
  version: string;
  previews: Preview[];
  modes: { academy: string; declaration: string };
}) {
  const d = useDo();
  const [name, setName] = useState(settings.name);
  const [title, setTitle] = useState(settings.title);
  const [said, setSaid] = useState<string | null>(null);
  const dirty = name.trim() !== settings.name || title.trim() !== settings.title;

  return (
    <div className="flex flex-col gap-6" data-testid="welcome-panel">
      <Notice error={d.error} saved={said} />

      <section aria-labelledby="sign-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="sign-heading" className="t-heading">
          The name under the email
        </h2>
        <p className="t-small text-soft">Two lines, typed at the bottom of the email. It is sent from the system’s own address, not from his mailbox.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">Name</span>
            <input className="input" data-testid="welcome-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">Title</span>
            <input className="input" data-testid="welcome-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        <div>
          <Button
            size="md"
            variant="quiet"
            data-testid="welcome-save"
            disabled={!dirty}
            loading={d.busy === "save"}
            onClick={() => void d.go("save", async () => {
              const r = await welcomeSaveAction(name, title);
              if (r.ok) setSaid(r.message);
              return r;
            })}
          >
            Save the name and title
          </Button>
        </div>
      </section>

      <section aria-labelledby="approve-heading" className="card flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="approve-heading" className="t-heading">
            Approval
          </h2>
          <span data-testid="welcome-status">
            <Badge tone={settings.approved ? "gold" : "outline"}>{settings.approved ? "Approved" : "Not approved"}</Badge>
          </span>
        </div>
        <p className="t-small text-soft">{WELCOME_APPROVE_HELP}</p>
        <p className="t-small text-soft">
          Wording version {version}.
          {settings.approved && settings.approvedAt ? ` Approved on ${formatShortDate(settings.approvedAt)}.` : ""}
          {!settings.approved && settings.approvedVersion ? " The wording has changed since it was last approved, so it needs approving again." : ""}
        </p>
        <div className="flex flex-wrap gap-3">
          {settings.approved ? (
            <Button
              size="md"
              variant="quiet"
              data-testid="welcome-withdraw"
              loading={d.busy === "withdraw"}
              onClick={() => void d.go("withdraw", async () => {
                const r = await welcomeWithdrawAction();
                if (r.ok) setSaid(r.message);
                return r;
              })}
            >
              Take the approval away
            </Button>
          ) : (
            <Button
              size="md"
              variant="solid"
              data-testid="welcome-approve"
              disabled={dirty}
              loading={d.busy === "approve"}
              onClick={() => void d.go("approve", async () => {
                const r = await welcomeApproveAction();
                if (r.ok) setSaid(r.message);
                return r;
              })}
            >
              {settings.name} has approved this wording
            </Button>
          )}
        </div>
        {dirty ? <p className="t-small text-soft">Save the name and title first, so what you approve is what is saved.</p> : null}
      </section>

      <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="preview-heading" className="t-heading">
            Read it
          </h2>
          <p className="t-small text-soft">
            Both versions, to a made-up leader, as they would be written today. The Academy is {modes.academy === "required" ? "required" : modes.academy === "optional" ? "optional" : "off"} and the safeguarding promises are {modes.declaration === "required" ? "required" : "off"} on your switchboard now, and the steps follow that. A mail program may show it a little differently.
          </p>
        </div>
        {previews.map((p) => (
          <article key={p.variant} className="card flex flex-col gap-3 p-4 sm:p-5" data-testid={`welcome-preview-${p.variant}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{p.variant === "choose" ? "When they may choose their goal" : "When their goal was chosen for them"}</h3>
              <span className="t-small text-soft">Subject: {p.subject}</span>
            </div>
            <iframe title={`Preview: ${p.variant === "choose" ? "may choose" : "goal chosen for them"}`} sandbox="" srcDoc={p.html} className="h-[42rem] w-full rounded-[var(--radius-control)] border border-line bg-white" />
            <details>
              <summary className="t-small cursor-pointer font-semibold">The plain-text version</summary>
              <pre className="t-small mt-2 whitespace-pre-wrap text-soft">{p.text}</pre>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
