import { WRITTEN_FIELDS, type WrittenField } from "./fields";
import { countWords } from "./text";

/**
 * The offline stand-in for the AI judge. It reads word patterns, nothing more, so tests, the comparison script's dry
 * run and a deployment without a key all work. It shows the plumbing and the thresholds behave; it does not show what
 * a real model can do. Measure that with `npm run bakeoff:leaders` and a real key, and set the thresholds in shadow mode.
 */

const count = (text: string, patterns: RegExp[]) => patterns.reduce((n, p) => n + (text.match(p)?.length ?? 0), 0);
const lc = (text: string) => ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

const TOPIC: Record<WrittenField, RegExp> = {
  goalStory: /\b(goal|start\w*|began|learn\w*|year|job|business|season|step|led|lead\w*|work\w*|famil\w*|school|grew|hard|challeng\w*|happen\w*|result|promot\w*|prayed|god)\b/i,
  why: /\b(lead\w*|help\w*|others|people|grow\w*|serv\w*|guid\w*|hope\w*|want\w*|walk\w*|support\w*|encourag\w*|church|tribe|someone|god)\b/i,
  walked: /\b(walk\w*|listen\w*|friend|stay\w*|visit\w*|call\w*|pray\w*|hard|season|loss|lost|sick\w*|support\w*|advi\w*|help\w*|sat|sit|brother|sister|colleague|neighbour)\b/i,
  walkNote: /\b(god|pray\w*|bible|walk\w*|faith|tired|busy|steady|church|devotion\w*|dry|close|distant|struggl\w*|prayer|word)\b/i,
  obstacles: /\b(work\w*|travel\w*|time|famil\w*|busy|tired|energy|job|child\w*|wife|husband|exam\w*|health|money|schedul\w*|plan\w*|assistant|ask|pastor|business|school|traffic|deadline|none|nothing)\b/i,
};
const SELF = /\b(i|my|me|we|our|i'm|i've|i'd)\b/i;

export function mockRelevance(data: { field: WrittenField; text: string }): { answers_question: boolean; note: string } {
  const ok = TOPIC[data.field].test(data.text) || (SELF.test(data.text) && countWords(data.text) >= 10);
  return { answers_question: ok, note: ok ? "" : "That does not seem to answer the question yet. Tell us in your own words, from your own life." };
}

type Facts = {
  track: string | null;
  community: string | null;
  goal: string | null;
  walkRating: string | null;
  answers: Record<WrittenField, string>;
};

/** A run of up to `max` words from the answer, starting at the first match of `marker`, copied exactly as written. */
function snippet(text: string, marker: RegExp, max = 14): string {
  const words = text.trim().split(/\s+/);
  let at = words.findIndex((w) => marker.test(w));
  if (at < 0) at = 0;
  // A match in the last few words would leave a quote too short to prove anything: start earlier instead.
  if (at > words.length - 4) at = Math.max(0, words.length - max);
  return words.slice(at, at + max).join(" ");
}

const STOCK = [/passion for/g, /make a difference/g, /give back/g, /laid (it )?on my heart/g, /to the glory/g, /i believe that i/g, /servant leader/g];

export function mockScore(data: Facts) {
  const a = data.answers;
  const t = Object.fromEntries(WRITTEN_FIELDS.map((f) => [f, lc(a[f] ?? "")])) as Record<WrittenField, string>;
  const words = Object.fromEntries(WRITTEN_FIELDS.map((f) => [f, countWords(a[f] ?? "")])) as Record<WrittenField, number>;

  // Q1 a story with the goal: specific and reflective
  let q1 = 1;
  if (words.goalStory >= 15) q1 += 1;
  if (words.goalStory >= 30) q1 += 1;
  if (/\d|january|february|march|april|may |june|july|august|september|october|november|december| when | because |i started|i left|i lost|i began/.test(t.goalStory)) q1 += 1;
  if (/learn|realis|realiz|taught me|understand|discovered/.test(t.goalStory)) q1 += 1;

  // Q2 a focus on others, not a title
  const others = count(t.why, [/\b(help\w*|others|people|grow\w*|encourag\w*|serv\w*|support\w*|guid\w*|someone|sit with|walk with)\b/g]);
  const self = count(t.why, [/\b(title|position|recognition|recogni[sz]ed|seen|respect|status|famous|promotion|cv|resume|look good|my image|be known)\b/g]);
  const humble = /humble|not about me|learn|god/.test(t.why) ? 1 : 0;
  const q2 = words.why < 8 ? 1 : 2 + Math.min(2, Math.floor(others / 2)) - Math.min(2, self) + humble;

  // Q3 walking with people: listening and staying, not fixing
  const good = count(t.walked, [/\blistened\b/g, /\bstayed\b/g, /\bprayed with\b/g, /\bvisited\b/g, /\bcalled\b/g, /\bsat with\b/g, /did not (give|try|tell|offer)/g, /didn't (give|try|tell|offer)/g, /boundar|respect|referred|counsel/g]);
  const fixing = count(t.walked, [/told (him|her|them) what to do/g, /\bi fixed\b/g, /\bi solved\b/g, /\bi paid\b/g, /\bi advised\b/g, /\bi told (him|her|them)\b/g, /gave (him|her|them) money/g]);
  let q3 = 2 + Math.min(3, good) - Math.min(2, fixing);
  if (words.walked < 15) q3 = Math.min(q3, 2);

  // Q4 honest about their own walk: the note matches the rating
  const rating = Number(data.walkRating ?? 0);
  const weak = count(t.walkNote, [/\b(tired|struggl\w*|weak|inconsistent|dry|busy|difficult|fail\w*|distracted|not as|less than|pray less|lazy|slack\w*)\b/g]);
  let q4 = 2 + (weak >= 1 ? 1 : 0) + (weak >= 2 ? 1 : 0) + (words.walkNote >= 12 ? 1 : 0);
  if (rating >= 5 && weak === 0) q4 = 1;
  if (words.walkNote < 6) q4 = 1;

  // Q5 self-awareness: real obstacles and what they would do
  const obstacles = count(t.obstacles, [/\b(work\w*|travel\w*|time|famil\w*|busy|tired|energy|job|child\w*|wife|husband|exam\w*|health|money|schedul\w*|business|school|traffic|deadline)\b/g]);
  const plan = count(t.obstacles, [/\bi will\b/g, /\bi would\b/g, /\bask\b/g, /\btell\b/g, /\bpastor\b/g, /\bassistant\b/g, /\bplan\w*\b/g, /\barrange\b/g, /\bspeak to\b/g, /\binform\b/g, /\bcoach\b/g, /\bswap\b/g, /\breschedul\w*\b/g]);
  let q5 = 1 + Math.min(2, obstacles) + (plan >= 1 ? 1 : 0) + (plan >= 2 ? 1 : 0);
  if (/\b(nothing|none|no obstacles?)\b/.test(t.obstacles) && words.obstacles < 10) q5 = 1;

  // Q6 fit: a reasonable fit unless something is missing
  const q6 = data.track && data.community && data.goal ? 3 : 2;

  const scores = { q1: clamp(q1), q2: clamp(q2), q3: clamp(q3), q4: clamp(q4), q5: clamp(q5), q6: clamp(q6) };

  const flags: string[] = [];
  const off = WRITTEN_FIELDS.filter((f) => !TOPIC[f].test(a[f] ?? "") && !SELF.test(a[f] ?? ""));
  if (off.length > 0) flags.push("off_topic");
  if (WRITTEN_FIELDS.some((f) => words[f] < 8)) flags.push("low_effort");
  const stock = WRITTEN_FIELDS.reduce((n, f) => n + count(t[f], STOCK), 0);
  if (stock >= 3 && !/\d/.test(Object.values(a).join(" "))) flags.push("generic_boilerplate");
  if (!data.track || !data.community || !data.goal) flags.push("poor_fit");

  const evidence: { question: string; field: string; quote: string }[] = [];
  const marks: [string, WrittenField, RegExp][] = [
    ["q1", "goalStory", /^(started|began|learned|learnt|realised|realized|left|lost|when|because|\d+)/i],
    ["q2", "why", /^(help\w*|others|people|grow\w*|encourag\w*|serv\w*|support\w*|someone)/i],
    ["q3", "walked", /^(listened|stayed|prayed|visited|called|sat)/i],
    ["q4", "walkNote", /^(tired|struggl\w*|busy|dry|steady|weak|pray|less)/i],
    ["q5", "obstacles", /^(work\w*|travel\w*|family|time|busy|tired|job|health)/i],
  ];
  for (const [q, field, marker] of marks) {
    if (scores[q as keyof typeof scores] >= 3 && (a[field] ?? "").trim()) evidence.push({ question: q, field, quote: snippet(a[field], marker) });
  }

  const hint: Record<WrittenField, string> = {
    goalStory: "Tell us what actually happened, with one specific moment and what you learned from it.",
    why: "Tell us what you hope for the people in your tribe, not for yourself.",
    walked: "Tell us what you did and what you chose not to do when you walked with them.",
    walkNote: "Say honestly where your walk with God is weak as well as where it is strong.",
    obstacles: "Name one real thing that could get in the way, and who you would tell and what you would do.",
  };
  const byQ: Record<WrittenField, number> = { goalStory: scores.q1, why: scores.q2, walked: scores.q3, walkNote: scores.q4, obstacles: scores.q5 };
  const feedback = WRITTEN_FIELDS.filter((f) => byQ[f] <= 2).map((f) => ({ field: f, note: hint[f] }));

  const avg = WRITTEN_FIELDS.reduce((n, f) => n + words[f], 0) / WRITTEN_FIELDS.length;
  const confidence = Math.round(Math.min(0.95, 0.55 + Math.min(0.35, avg / 100)) * 100) / 100;
  const reason = (s: number) => (s >= 4 ? "Specific and clear." : s === 3 ? "Reasonable, with some detail." : "Thin or general.");
  return {
    scores,
    reasons: { q1: reason(scores.q1), q2: reason(scores.q2), q3: reason(scores.q3), q4: reason(scores.q4), q5: reason(scores.q5), q6: reason(scores.q6) },
    evidence,
    feedback,
    flags,
    confidence,
  };
}
