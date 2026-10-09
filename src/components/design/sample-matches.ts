import type { MatchCardData } from "@/components/ui/MatchCard";

/** Invented sample data for the style page and the phone preview. Not real people. */
export const SAMPLE_MATCHES: MatchCardData[] = [
  {
    circleName: "Surulere Wednesday Tribe",
    tribe: "Professionals",
    track: "Builders",
    goal: "Step into a leadership role",
    leaderFirstName: "Funmi",
    leaderLine: "Led a 40-person team at a bank and remembers her first year as a manager.",
    meeting: "Wed 7:30pm, online",
    seatsLeft: 3,
    degree: 91,
    reasons: [
      "Same goal: you mentioned leading a new team",
      "Same season of life: Builders, in banking and finance",
      "Meets on the evening you chose",
    ],
    parts: [
      { key: "goal", label: "Goal", score: 1 },
      { key: "season", label: "Season of life", score: 0.92 },
      { key: "place", label: "Place and rhythm", score: 0.85 },
      { key: "fit", label: "Style and faith", score: 0.8 },
    ],
  },
  {
    circleName: "Lekki Career Shift Tribe",
    tribe: "Professionals",
    track: "Builders",
    goal: "Change career direction with confidence",
    leaderFirstName: "Tunde",
    leaderLine: "Moved from engineering to product at 34 and coaches others through the same move.",
    meeting: "Thu 8:00pm, online",
    seatsLeft: 5,
    degree: 78,
    reasons: ["Close goal: you said you were weighing a move", "Same tribe and life stage", "Meets online, so no travel"],
    parts: [
      { key: "goal", label: "Goal", score: 0.7 },
      { key: "season", label: "Season of life", score: 0.9 },
      { key: "place", label: "Place and rhythm", score: 0.7 },
      { key: "fit", label: "Style and faith", score: 0.85 },
    ],
  },
  {
    circleName: "Yaba Marriage Foundations",
    tribe: "Marriage & Relationships",
    track: "Builders",
    goal: "Prepare well for marriage",
    leaderFirstName: "Ada",
    leaderLine: "Married eight years; walked three couples through their first year.",
    meeting: "Sat 4:00pm, in person",
    seatsLeft: 2,
    degree: 64,
    reasons: ["Your second tribe choice", "Same life stage", "Close to home in Yaba"],
    parts: [
      { key: "goal", label: "Goal", score: 0.45 },
      { key: "season", label: "Season of life", score: 0.8 },
      { key: "place", label: "Place and rhythm", score: 0.6 },
      { key: "fit", label: "Style and faith", score: 0.7 },
    ],
  },
];
