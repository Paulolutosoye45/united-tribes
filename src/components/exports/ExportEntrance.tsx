import Link from "next/link";
import { loadExportOptions } from "@/lib/exports/server";
import { packInfo } from "@/lib/exports/registry";
import type { PackId } from "@/lib/exports/types";
import { createClient } from "@/lib/supabase/server";

type Props = {
  /** The packs that make sense on this page. Only those the person may make now are shown. */
  packs: readonly PackId[];
  tribe?: string | null;
  community?: string | null;
  season?: string | null;
};

/**
 * A quiet way into the Export Studio from the page where the figures already are. It shows nothing at all unless the church has opened
 * one of these packs to this person's role, so while everything is Off no screen changes. It never carries a switch.
 */
export async function ExportEntrance({ packs, tribe, community, season }: Props) {
  const options = await loadExportOptions(await createClient());
  if (!options || !options.open) return null;
  const list = options.packs.filter((p) => packs.includes(p.id));
  if (list.length === 0) return null;
  const query = (id: string, scope: string) => {
    const q = new URLSearchParams({ pack: id });
    if (scope === "tribe" && tribe) q.set("tribe", tribe);
    if (scope === "community" && community) q.set("community", community);
    if (season) q.set("season", season);
    return `/exports?${q.toString()}`;
  };
  return (
    <section aria-label="Take this with you" className="card flex flex-col gap-3 p-4 sm:p-5" data-testid="export-entrance">
      <div>
        <h2 className="font-semibold">Take this with you</h2>
        <p className="t-small text-soft">A spreadsheet or a printed page, made when you ask.</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {list.map((p) => (
          <li key={p.id}>
            <Link href={query(p.id, p.scope)} className="press inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[0.92rem] font-medium hover:border-soft" title={packInfo(p.id)?.line}>
              {p.name}
              {p.rehearsal ? <span className="t-small ml-2 text-soft">Rehearsal</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
