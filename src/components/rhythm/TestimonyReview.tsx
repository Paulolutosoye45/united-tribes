"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reviewTestimonyAction } from "@/app/(app)/rhythm/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { PendingTestimony, TestimonyTheme } from "@/lib/rhythm/types";
import { ThemePicker } from "./ThemePicker";

const CREDIT = { full_name: "full name", first_name: "first name", anonymous: "no name" } as const;

/** Testimonies waiting to be read. A leader approves for the tribe; a pastor approves for the church. */
export function TestimonyReview({ items, scope, emptyText }: { items: PendingTestimony[]; scope: "tribe" | "church"; emptyText: string }) {
  const router = useRouter();
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themes, setThemes] = useState<Record<string, TestimonyTheme[]>>({});

  async function decide(id: string, decision: "approve" | "decline") {
    setWorking(id);
    setError(null);
    const result = await reviewTestimonyAction(id, decision, decision === "decline" ? note : "", themes[id]);
    setWorking(null);
    if (!result.ok) return setError(result.message);
    setDeclining(null);
    setNote("");
    router.refresh();
  }

  if (items.length === 0) return <p className="t-body text-soft">{emptyText}</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul className="stagger flex flex-col gap-3">
        {items.map((t, i) => (
          <li key={t.id} style={{ ["--i" as string]: Math.min(i, 8) }} className="card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{t.by}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="outline">{t.tribe}</Badge>
                <Badge tone="neutral">{t.share_with === "church" ? "For the church" : "For the tribe"}</Badge>
              </div>
            </div>
            <p className="t-body whitespace-pre-line">{t.body}</p>
            <p className="t-small text-soft">They would like to be shown with {CREDIT[t.credit]}.{scope === "church" && t.status === "tribe_approved" ? " The leader has approved it for the tribe." : ""}</p>
            <ThemePicker value={themes[t.id] ?? []} onChange={(next) => setThemes({ ...themes, [t.id]: next })} label="Tag it so it can be found later. Choose up to three." />
            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm" variant="solid" loading={working === t.id && declining !== t.id} onClick={() => void decide(t.id, "approve")}>
                {scope === "church" ? "Approve for the church" : "Approve"}
              </Button>
              <Button size="sm" variant="ghost" aria-expanded={declining === t.id} onClick={() => setDeclining(declining === t.id ? null : t.id)}>
                Decline
              </Button>
            </div>
            {declining === t.id ? (
              <form
                noValidate
                className="flex flex-col gap-3 border-t border-line pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void decide(t.id, "decline");
                }}
              >
                <Input label="A note for them" name={`why-${t.id}`} optional maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} hint="For example, ask them to leave out a name. They will read it." />
                <div>
                  <Button type="submit" size="sm" loading={working === t.id}>
                    Decline this testimony
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
