"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestGuardianAction } from "@/app/(app)/tribe/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { RELATIONSHIPS, relationshipLabel } from "@/lib/guardian/consent";
import type { MyGuardian, RelationshipKind } from "@/lib/growth/types";

type Needed = Extract<MyGuardian, { needed: true }>;

/**
 * What a young person sees until a parent or guardian has said yes and the Care Team has phoned them: the way to ask,
 * and where the request stands. They never see the private link; it goes to the parent or guardian.
 */
export function TeenWaiting({ guardian, name }: { guardian: Needed; name: string | null }) {
  const first = name?.trim().split(/\s+/)[0] ?? null;
  const { state } = guardian;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="t-title">{first ? `Almost there, ${first}.` : "Almost there."}</h1>
        <p className="t-body measure text-soft">
          Because you are under 18, a parent or guardian needs to say yes before we show you tribes. It takes one link, and a short phone call from our Care Team.
        </p>
      </header>

      {!guardian.track_open ? (
        <section className="card flex flex-col gap-2 p-5 sm:p-7" role="status">
          <h2 className="t-heading">Tribes for young people are not open yet</h2>
          <p className="t-body text-soft">We will let you know as soon as they are. Nothing more is needed from you now.</p>
        </section>
      ) : state === "none" || state === "expired" ? (
        <Ask guardian={guardian} intro={state === "expired" ? "The link we sent has expired. Send a new one." : null} />
      ) : state === "requested" ? (
        <Requested guardian={guardian} />
      ) : state === "approved" ? (
        <section className="card flex flex-col gap-3 p-5 sm:p-7" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="t-heading">{guardian.guardian_name ?? "Your parent or guardian"} said yes</h2>
            <Badge tone="gold">One step left</Badge>
          </div>
          <p className="t-body text-soft">
            A member of our Care Team will phone or write to them to check it was really them. When that is done, you will be able to see tribes. We will message you.
          </p>
        </section>
      ) : (
        <section className="card flex flex-col gap-3 p-5 sm:p-7" role="status">
          <h2 className="t-heading">{state === "withdrawn" ? "Your parent or guardian took their permission back" : "Your parent or guardian said no"}</h2>
          <p className="t-body text-soft">
            That is their decision, and we respect it. Talk with them first. If they change their mind, they can use the same link, or you can ask the Care Team of The
            Covenant Nation to open this up again.
          </p>
        </section>
      )}
    </div>
  );
}

function Requested({ guardian }: { guardian: Needed }) {
  const [again, setAgain] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <section className="card flex flex-col gap-3 p-5 sm:p-7" role="status">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="t-heading">Waiting for {guardian.guardian_name ?? "your parent or guardian"}</h2>
          <Badge tone="neutral">Link sent</Badge>
        </div>
        <p className="t-body text-soft">
          We sent a private link to {guardian.sent_to ?? "them"}. It stays valid for 14 days. You won&rsquo;t see it: it is for them. Ask them to look in their messages, and in
          their spam folder.
        </p>
        {guardian.can_send && !again ? (
          <div>
            <Button variant="quiet" size="sm" onClick={() => setAgain(true)}>
              Send it again, or to a different address
            </Button>
          </div>
        ) : null}
        {!guardian.can_send ? <p className="t-small text-soft">We have sent this three times today. You can try again tomorrow.</p> : null}
      </section>
      {again ? <Ask guardian={guardian} intro={null} /> : null}
    </div>
  );
}

function Ask({ guardian, intro }: { guardian: Needed; intro: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(guardian.guardian_name ?? "");
  const [relationship, setRelationship] = useState<RelationshipKind | "">(guardian.relationship ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length >= 2 && relationship !== "" && (email.trim() !== "" || phone.trim() !== "");

  async function send() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await requestGuardianAction(name, relationship, email, phone);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <form
      noValidate
      aria-labelledby="ask-heading"
      className="card flex flex-col gap-5 p-5 sm:p-7"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 id="ask-heading" className="t-heading">
          Ask your parent or guardian
        </h2>
        <p className="t-body text-soft">{intro ?? "Tell us who they are and how to reach them. We send them a private link, and they read what they are agreeing to and answer."}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Their name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Select label="Who they are to you" value={relationship} onChange={(e) => setRelationship(e.target.value as RelationshipKind | "")}>
          <option value="">Choose</option>
          {RELATIONSHIPS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
        <Input label="Their email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} optional />
        <Input label="Their phone number" type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={24} optional hint="With the country code, or starting 0." />
      </div>
      <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3 text-ink">
        Use their own email or number, not yours. We will phone or write to them to check it was really them who said yes
        {guardian.relationship ? `, ${relationshipLabel(guardian.relationship).toLowerCase()}` : ""}.
      </p>
      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="md" loading={busy} disabled={!ready}>
          Send them the link
        </Button>
      </div>
    </form>
  );
}
