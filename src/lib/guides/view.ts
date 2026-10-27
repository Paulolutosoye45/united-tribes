import { pieces, plain, type Piece } from "./markup";
import { madeOnLabel, pictureOf, pictureUrl } from "./pictures";
import type { Guide, PictureInfo, Step } from "./types";

/**
 * What the pages receive: a guide turned into plain data (no functions, no finders), with every line already split into its
 * marks, so the part of the page that runs in the browser stays small and never sees how a picture was made.
 */
export type PictureView = {
  url: string;
  width: number;
  height: number;
  device: PictureInfo["device"];
  alt: string;
  rings: PictureInfo["rings"];
  tag?: PictureInfo["tag"];
};

export type StepView = {
  id: string;
  /** 1-based, across the whole guide. */
  n: number;
  part: number;
  partTitle: string;
  /** 1-based, inside its part. */
  inPart: number;
  title: string;
  lines: Piece[][];
  tip?: Piece[];
  why?: Piece[];
  careful?: Piece[];
  example?: Piece[];
  timeline?: { when: Piece[]; what: Piece[] }[];
  picture?: PictureView;
};

export type NextView = { slug: string; code: string; title: string; minutes: number; steps: number; cover: PictureView | null };

export type GuideView = {
  code: string;
  slug: string;
  title: string;
  lede: string;
  forWho: string;
  minutes: number;
  ready: Piece[][];
  parts: { title: string; blurb?: string; first: number; steps: number }[];
  steps: StepView[];
  ifDifferent: string;
  whoSees: Piece[][];
  madeOn: string | null;
  shortcut: { label: string; toStep: string } | null;
  next: NextView[];
};

const some = (line: string | undefined) => (line ? pieces(line) : undefined);

function pictureView(slug: string, step: Step): PictureView | undefined {
  if (!step.shot) return undefined;
  const p = pictureOf(slug, step.id);
  if (!p) return undefined;
  return { url: pictureUrl(slug, p), width: p.width, height: p.height, device: p.device, alt: step.shot.alt, rings: p.rings, tag: p.tag };
}

export function stepCount(g: Guide): number {
  return g.parts.reduce((n, p) => n + p.steps.length, 0);
}

/** The first picture of a guide, for its card. */
export function coverOf(g: Guide): PictureView | null {
  for (const part of g.parts) for (const step of part.steps) {
    const v = pictureView(g.slug, step);
    if (v) return v;
  }
  return null;
}

export function viewOf(g: Guide, next: readonly Guide[]): GuideView {
  const steps: StepView[] = [];
  const parts: GuideView["parts"] = [];
  let n = 0;
  g.parts.forEach((part, pi) => {
    parts.push({ title: part.title, blurb: part.blurb, first: n, steps: part.steps.length });
    part.steps.forEach((step, si) => {
      n++;
      steps.push({
        id: step.id,
        n,
        part: pi,
        partTitle: part.title,
        inPart: si + 1,
        title: step.title,
        lines: step.do.map(pieces),
        tip: some(step.tip),
        why: some(step.why),
        careful: some(step.careful),
        example: some(step.example),
        timeline: step.timeline?.map((t) => ({ when: pieces(t.when), what: pieces(t.what) })),
        picture: pictureView(g.slug, step),
      });
    });
  });
  return {
    code: g.code,
    slug: g.slug,
    title: g.title,
    lede: g.lede,
    forWho: g.forWho,
    minutes: g.minutes,
    ready: g.ready.map(pieces),
    parts,
    steps,
    ifDifferent: g.ifDifferent,
    whoSees: (g.whoSees ?? []).map(pieces),
    madeOn: madeOnLabel(g.slug),
    shortcut: g.shortcut ?? null,
    next: next.map((x) => ({ slug: x.slug, code: x.code, title: x.title, minutes: x.minutes, steps: stepCount(x), cover: coverOf(x) })),
  };
}

/** A guide as the library shows it: a card. `search` is everything a person might type to find it, in lower case. */
export type CardView = {
  slug: string;
  code: string;
  title: string;
  lede: string;
  forWho: string;
  minutes: number;
  steps: number;
  cover: PictureView | null;
  /** Where the card goes, when it is not /guides/<slug>. */
  href?: string;
  search: string;
};

export function cardOf(g: Guide): CardView {
  const words = [g.code, g.title, g.lede, g.forWho, ...g.parts.flatMap((p) => [p.title, ...p.steps.flatMap((s) => [s.title, ...s.do])])];
  return {
    slug: g.slug,
    code: g.code,
    title: g.title,
    lede: g.lede,
    forWho: g.forWho,
    minutes: g.minutes,
    steps: stepCount(g),
    cover: coverOf(g),
    search: words.map(plain).join(" ").toLowerCase(),
  };
}
