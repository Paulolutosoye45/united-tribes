"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { refinePictureAction } from "@/app/(app)/rhythm/actions";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import type { CircleWeek } from "@/lib/rhythm/types";

/** Week 1 work: the circle settles the words of its Success Picture together, and the leader saves the final version. */
export function PictureForm({ week }: { week: CircleWeek }) {
  const router = useRouter();
  const [god, setGod] = useState(week.picture.god);
  const [others, setOthers] = useState(week.picture.others);
  const [life, setLife] = useState(week.picture.life);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await refinePictureAction(week.circle.id, god, others, life);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSaved(true);
    router.refresh();
  }

  return (
    <section id="picture" aria-labelledby="picture-heading" className="card flex scroll-mt-24 flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="picture-heading" className="t-heading">
          Settle your Success Picture
        </h2>
        <p className="t-small text-soft">
          Change the words with your Tribe until everyone can say each line. Save the final version in the first two weeks. Members see it on their page, and answer the halfway and final check-ins against it.
        </p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Textarea label="Loving God" name="god" rows={2} maxLength={200} value={god} onChange={(e) => setGod(e.target.value)} className="!min-h-20" />
        <Textarea label="Loving Others" name="others" rows={2} maxLength={200} value={others} onChange={(e) => setOthers(e.target.value)} className="!min-h-20" />
        <Textarea label="Loving Life" name="life" rows={2} maxLength={200} value={life} onChange={(e) => setLife(e.target.value)} className="!min-h-20" />
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" loading={busy}>
            {week.picture.refined ? "Save changes" : "Save the final version"}
          </Button>
          {saved ? (
            <p role="status" className="t-small text-soft">
              Saved. Members can see it now.
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
