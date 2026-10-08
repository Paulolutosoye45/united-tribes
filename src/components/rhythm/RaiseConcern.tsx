"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { raiseConcernAction } from "@/app/(app)/rhythm/actions";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";

/** For the person you are worried about even though nothing in the numbers says so. */
export function RaiseConcern({ circleId, people }: { circleId: string; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (people.length === 0) return null;

  async function save() {
    if (!person) return setError("Choose who you are worried about.");
    setBusy(true);
    setError(null);
    const result = await raiseConcernAction(circleId, person, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSent(true);
    setOpen(false);
    setPerson("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          Someone I am worried about
        </Button>
        {sent ? (
          <p role="status" className="t-small text-soft">
            Added to your list of people to call.
          </p>
        ) : null}
      </div>
      {open ? (
        <form
          noValidate
          className="card flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Select label="Who?" name="person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Choose a member</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input label="What have you noticed?" name="concern" optional maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint="Only you, your coach and the care team can read this." />
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" size="md" loading={busy}>
              Add to my list
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
