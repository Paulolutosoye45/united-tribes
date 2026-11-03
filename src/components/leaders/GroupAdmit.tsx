"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markGroupAction } from "@/app/(app)/lead/tribe/group-actions";
import { whatsappLink } from "@/lib/leaders/status";
import { GROUP_WORDS, type GroupList } from "@/lib/placement/group";

/**
 * The leader's WhatsApp group list. People appear under "Ready to add" only after they have said yes; those still to answer are names and nothing
 * more. The ticks are the leader's own record, so an assistant does not add the same person twice.
 */
export function GroupAdmit({ tribeId, list }: { tribeId: string; list: GroupList }) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mark(person: string, kind: "admitted" | "removed", done: boolean) {
    setWorking(`${kind}:${person}`);
    setError(null);
    const result = await markGroupAction(tribeId, person, kind, done);
    setWorking(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (list.admit.length === 0 && list.waiting.length === 0 && list.remove.length === 0) return null;
  const todo = list.admit.filter((p) => !p.admitted).length;

  return (
    <section aria-labelledby="group-heading" className="flex flex-col gap-4" data-testid="group-admit">
      <div className="flex flex-col gap-2">
        <h2 id="group-heading" className="t-heading">
          {GROUP_WORDS.title}
        </h2>
        <p className="t-body measure text-soft">{GROUP_WORDS.intro}</p>
        {!list.has_link ? <p className="t-small text-soft">{GROUP_WORDS.noLink}</p> : null}
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:p-5">
        <h3 className="font-semibold">{GROUP_WORDS.admitHeading}</h3>
        {list.admit.length === 0 ? (
          <p className="t-small text-soft" data-testid="group-admit-empty">
            {GROUP_WORDS.admitEmpty}
          </p>
        ) : (
          <>
            {todo === 0 ? <p className="t-small text-soft">{GROUP_WORDS.admitDone}</p> : null}
            <ul className="flex flex-col divide-y divide-line">
              {list.admit.map((p) => (
                <li key={p.person_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" data-testid="group-admit-row">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">{p.name}</p>
                    {p.whatsapp ? (
                      <p className="t-small">
                        <a className="font-semibold underline underline-offset-4" href={whatsappLink(p.whatsapp, "")} target="_blank" rel="noreferrer">
                          {p.whatsapp}
                        </a>
                      </p>
                    ) : (
                      <p className="t-small text-soft">{p.private ? GROUP_WORDS.privateNote : GROUP_WORDS.noNumber}</p>
                    )}
                  </div>
                  <label className="flex min-h-10 items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={p.admitted}
                      disabled={working === `admitted:${p.person_id}`}
                      onChange={(e) => mark(p.person_id, "admitted", e.target.checked)}
                      data-testid="group-admitted"
                    />
                    <span className="text-[0.95rem]">{GROUP_WORDS.addedLabel}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {list.waiting.length > 0 ? (
        <div className="card flex flex-col gap-2 p-4 sm:p-5" data-testid="group-waiting">
          <h3 className="font-semibold">{GROUP_WORDS.waitingHeading}</h3>
          <p className="t-small text-soft">{GROUP_WORDS.waitingLine}</p>
          <p className="t-body">{list.waiting.join(", ")}</p>
        </div>
      ) : null}

      {list.remove.length > 0 ? (
        <div className="card flex flex-col gap-3 p-4 sm:p-5" data-testid="group-remove">
          <h3 className="font-semibold">{GROUP_WORDS.removeHeading}</h3>
          <p className="t-small text-soft">{GROUP_WORDS.removeLine}</p>
          <ul className="flex flex-col divide-y divide-line">
            {list.remove.map((p) => (
              <li key={p.person_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <p className="font-medium leading-snug">{p.name}</p>
                <label className="flex min-h-10 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={p.removed}
                    disabled={working === `removed:${p.person_id}`}
                    onChange={(e) => mark(p.person_id, "removed", e.target.checked)}
                    data-testid="group-removed"
                  />
                  <span className="text-[0.95rem]">{GROUP_WORDS.removedLabel}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
