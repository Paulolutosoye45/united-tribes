"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveRefereeAction } from "@/app/(focus)/lead/apply/actions";
import { makeRefereeLinkAction } from "@/app/(app)/lead/actions";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Input } from "@/components/ui/Input";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { refereeProblem, type RefereeInput } from "@/lib/leaders/answers";
import { refereeMessage, salutation, whatsappLink } from "@/lib/leaders/status";
import type { ReferenceRecord } from "@/lib/leaders/server";

export function RefereeLinks({ appId, references }: { appId: string; references: ReferenceRecord[] }) {
  const waiting = references.filter((r) => !r.answered).length;
  return (
    <section aria-labelledby="referees-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="referees-heading" className="t-heading">
          Your referees
        </h2>
        <p className="t-small text-soft">
          {waiting === 0
            ? "Both have answered. Thank you."
            : "Send each person their own private link. It works once and expires in 30 days."}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {references.map((r) => (
          <RefereeRow key={r.id} appId={appId} reference={r} />
        ))}
      </ul>
    </section>
  );
}

function RefereeRow({ appId, reference }: { appId: string; reference: ReferenceRecord }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  async function makeLink() {
    setBusy(true);
    setError(null);
    const result = await makeRefereeLinkAction(reference.id);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setUrl(result.url);
    setCopied(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn’t copy. Press and hold the link to copy it.");
    }
  }

  const phone = normaliseWhatsapp(reference.contact);

  return (
    <li className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{reference.name}</p>
          <p className="t-small text-soft">
            {reference.relationship}
            {reference.head ? ", pastor or unit head" : ""}
          </p>
        </div>
        {reference.answered ? <Badge tone="gold">Answered</Badge> : <Badge tone="outline">Waiting</Badge>}
      </div>

      {reference.answered ? null : changing ? (
        <ChangeReferee
          appId={appId}
          slot={reference.slot}
          current={{ name: reference.name, relationship: reference.relationship, contact: reference.contact, head: reference.head }}
          onDone={() => {
            setChanging(false);
            setUrl(null);
            router.refresh();
          }}
          onCancel={() => setChanging(false)}
        />
      ) : (
        <>
          {url ? (
            <div className="pop-in flex flex-col gap-3">
              <label className="t-small font-medium" htmlFor={`link-${reference.id}`}>
                Private link for {salutation(reference.name)}
              </label>
              <input
                id={`link-${reference.id}`}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-surface px-4 text-[0.9rem] text-soft"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <a
                  href={whatsappLink(phone, refereeMessage(reference.name, url))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses({ size: "md" })}
                >
                  <span className="relative">Send on WhatsApp</span>
                </a>
                <Button variant="quiet" size="md" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
              <p className="t-small text-soft">
                This link is shown only now and works once. If you lose it, make a new one. The old one stops working.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button size="md" loading={busy} onClick={() => void makeLink()}>
                {reference.expired ? "Make a new link" : "Get private link"}
              </Button>
              <Button variant="ghost" size="md" onClick={() => setChanging(true)}>
                Change this person
              </Button>
            </div>
          )}
          {reference.expired && !url ? <p className="t-small text-danger">This link has expired. Make a new one.</p> : null}
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

function ChangeReferee({
  appId,
  slot,
  current,
  onDone,
  onCancel,
}: {
  appId: string;
  slot: 1 | 2;
  current: RefereeInput;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<RefereeInput>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = refereeProblem(value);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const result = await saveRefereeAction(appId, slot, value);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone();
  }

  return (
    <div className="pop-in flex flex-col gap-4">
      <Input label="Their name" value={value.name} maxLength={80} onChange={(e) => setValue({ ...value, name: e.target.value })} />
      <Input label="How do you know them?" value={value.relationship} maxLength={80} onChange={(e) => setValue({ ...value, relationship: e.target.value })} />
      <Input label="Their phone number or email" value={value.contact} maxLength={120} onChange={(e) => setValue({ ...value, contact: e.target.value })} />
      <Choice
        type="checkbox"
        name={`change-head-${slot}`}
        value="yes"
        checked={value.head}
        onChange={(e) => setValue({ ...value, head: e.target.checked })}
        title="This person is a pastor or unit head"
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button size="md" loading={busy} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="t-small text-soft">Changing a referee cancels their old link. You can then make a new one.</p>
    </div>
  );
}
