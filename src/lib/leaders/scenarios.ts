/**
 * The six situations. The wording lives here; the answer key lives only in the
 * database (scenario_keys), where no one can read it through the API.
 * Display order is shuffled per applicant so position gives nothing away.
 * Wording and key are proposals for the pastorate to approve.
 */
export const SCENARIO_IDS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const OPTION_IDS = ["a", "b", "c", "d"] as const;
export type OptionId = (typeof OPTION_IDS)[number];

export type Scenario = {
  id: ScenarioId;
  title: string;
  situation: string;
  options: readonly { id: OptionId; text: string }[];
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "s1",
    title: "One voice fills the room",
    situation:
      "In your tribe, Tunde answers every question first and talks for several minutes. The quieter members have stopped trying to speak.",
    options: [
      { id: "a", text: "Say nothing. He will notice that others want a turn." },
      { id: "b", text: "Thank him warmly, then invite others by name. If it keeps happening, speak to him privately after." },
      { id: "c", text: "Wait until the meeting ends and speak to him alone, without changing anything in the room." },
      { id: "d", text: "Tell him in front of everyone to give others a chance." },
    ],
  },
  {
    id: "s2",
    title: "A member goes quiet",
    situation: "Chioma has missed two meetings in a row and has not replied to your WhatsApp messages.",
    options: [
      { id: "a", text: "Give her space. She will return when she is ready." },
      { id: "b", text: "Call her with no guilt, tell her she was missed, and let your coach know if she still does not reply." },
      { id: "c", text: "Remind the tribe that attendance matters, and name the people who have been absent." },
      { id: "d", text: "Send a warm message, keep her place open, and check again next week." },
    ],
  },
  {
    id: "s3",
    title: "Words that worry you",
    situation:
      "After the meeting, Emeka says quietly, “Sometimes I think everyone would be better off without me.” Then he laughs it off.",
    options: [
      { id: "a", text: "Stay with him, take it seriously, and contact the care lead the same day. Do not promise to keep it secret." },
      { id: "b", text: "Encourage him, pray together, and ask how he is doing next week." },
      { id: "c", text: "Pray with him, and message your coach that evening to ask what to do." },
      { id: "d", text: "Promise to keep it between the two of you, so he keeps trusting you." },
    ],
  },
  {
    id: "s4",
    title: "A sharp disagreement",
    situation: "Bisi and Kunle begin arguing hard over a point of doctrine. Voices are rising and the others are uneasy.",
    options: [
      { id: "a", text: "Calm the room, say you will come back to it after, and involve your coach or a pastor rather than ruling on it yourself." },
      { id: "b", text: "Give your own answer so the matter is settled." },
      { id: "c", text: "Let them carry on. Iron sharpens iron." },
      { id: "d", text: "Move on to the next question, and speak to each of them separately afterwards." },
    ],
  },
  {
    id: "s5",
    title: "Running on empty",
    situation: "You are exhausted after a hard week, and your tribe meets in an hour. Your assistant leader is free.",
    options: [
      { id: "a", text: "Ask your assistant leader to lead tonight, and rest." },
      { id: "b", text: "Push through and tell no one. A leader shows up." },
      { id: "c", text: "Message the tribe to cancel this week, and rest." },
      { id: "d", text: "Go, keep it short, and ask someone else to lead the prayer." },
    ],
  },
  {
    id: "s6",
    title: "A request for money",
    situation: "A member in real need asks you for a personal loan, and asks you not to tell anyone.",
    options: [
      { id: "a", text: "Decline kindly, and help them reach the care ladder, where support is given properly." },
      { id: "b", text: "Lend a small amount quietly from your own pocket." },
      { id: "c", text: "Tell the tribe about the need and ask everyone to give." },
      { id: "d", text: "Say you will think about it, and hope the matter fades." },
    ],
  },
];

/** A small, stable hash so the same applicant always sees the same order. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic shuffle: the same seed gives the same order, different seeds differ. */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = hash(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && (SCENARIO_IDS as readonly string[]).includes(value);
}
export function isOptionId(value: unknown): value is OptionId {
  return typeof value === "string" && (OPTION_IDS as readonly string[]).includes(value);
}
