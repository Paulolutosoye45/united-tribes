/**
 * The pastor's "Tribe fit" panel on the review page. The database decides who sees it (a pastor or director always; another
 * reviewer only after scoring) and sends only what that person may see. This file reads the answer into a fixed shape and says it in
 * words. Whatever the panel says, a pastor decides the application: it is a note, and it moves no score and no status.
 */

export const FIT_PART_KEYS = ["calling", "judgement", "style", "need", "stage"] as const;
export type FitPartKey = (typeof FIT_PART_KEYS)[number];

export const FIT_PART_LABEL: Record<FitPartKey, string> = {
  calling: "Calling",
  judgement: "Judgement",
  style: "Leading style",
  need: "Need",
  stage: "Stage of life",
};

export type PanelPick = { title: string; community: string };
export type PanelOther = { title: string; community: string; degree: number; label: string };

export type FitPanelRun = {
  /** The tribe the leader was shown first, or null when they wrote their own before the results. */
  first: PanelPick | null;
  wroteOwn: boolean;
  chosen: PanelPick | null;
  degree: number | null;
  label: string | null;
  parts: Record<FitPartKey, number> | null;
  flags: string[];
  backups: PanelPick[];
  others: PanelOther[];
  /** How many times the leader changed their choice. */
  picks: number;
  shown: number;
  options: number;
  model: string | null;
  at: string | null;
};

export type FitPanel = { visible: false } | { visible: true; run: FitPanelRun | null };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

function pick(v: unknown): PanelPick | null {
  if (!isObject(v)) return null;
  const title = str(v.title);
  return title ? { title, community: str(v.community) ?? "" } : null;
}

/** Reads the panel. Anything not in the expected shape is "not shown"; it never throws. */
export function parseFitPanel(json: unknown): FitPanel {
  if (!isObject(json) || json.visible !== true) return { visible: false };
  if (!isObject(json.run)) return { visible: true, run: null };
  const r = json.run;
  let parts: FitPanelRun["parts"] = null;
  if (isObject(r.parts)) {
    const got = {} as Record<FitPartKey, number>;
    let all = true;
    for (const k of FIT_PART_KEYS) {
      const n = int((r.parts as Record<string, unknown>)[k]);
      if (n === null) all = false;
      else got[k] = Math.max(0, Math.min(100, n));
    }
    if (all) parts = got;
  }
  return {
    visible: true,
    run: {
      first: pick(r.first),
      wroteOwn: r.wrote_own === true,
      chosen: pick(r.chosen),
      degree: int(r.degree),
      label: str(r.label),
      parts,
      flags: Array.isArray(r.flags) ? r.flags.map((f) => (isObject(f) ? str(f.text) : null)).filter((t): t is string => t !== null) : [],
      backups: Array.isArray(r.backups) ? r.backups.map(pick).filter((p): p is PanelPick => p !== null).slice(0, 2) : [],
      others: Array.isArray(r.others)
        ? r.others
            .map((o) => {
              const p = pick(o);
              const rec = isObject(o) ? o : {};
              const degree = int(rec.degree);
              const label = str(rec.label);
              return p && degree !== null && label ? { ...p, degree, label } : null;
            })
            .filter((o): o is PanelOther => o !== null)
            .slice(0, 3)
        : [],
      picks: Math.max(0, int(r.picks) ?? 0),
      shown: Math.max(0, int(r.shown) ?? 0),
      options: Math.max(0, int(r.options) ?? 0),
      model: str(r.model),
      at: str(r.at),
    },
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Strong match, 78%" for the tribe the leader chose. */
export function chosenLine(run: FitPanelRun): string {
  if (!run.chosen) return "Did not choose a tribe from the list.";
  const where = run.chosen.community ? ` (${run.chosen.community})` : "";
  const word = run.label ? `${cap(run.label)}${run.label === "stretch" ? "" : " match"}${run.degree !== null && run.label !== "stretch" ? `, ${run.degree}%` : ""}` : null;
  return `Chose ${run.chosen.title}${where}${word ? `. ${word}.` : "."}`;
}

/** What the leader was looking at first, when it is not the tribe they chose. Null when there is nothing to say. */
export function firstLine(run: FitPanelRun): string | null {
  if (run.wroteOwn) return "Started by writing their own tribe, before seeing the results.";
  if (run.first && run.chosen && run.first.title !== run.chosen.title) return `Started with ${run.first.title}, then chose another after seeing the results.`;
  return null;
}

/** "Changed their choice 2 times." Null when the leader chose once. */
export function changedLine(run: FitPanelRun): string | null {
  if (run.picks <= 1) return null;
  const times = run.picks - 1;
  return `Changed their choice ${times} ${times === 1 ? "time" : "times"}.`;
}
