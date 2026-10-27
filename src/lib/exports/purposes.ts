import type { PurposeKey } from "./types";

/** The reasons a People file can be made for. The database holds the same keys; the words are the app's. */
export const PURPOSES: Record<PurposeKey, string> = {
  pastoral_care: "Pastoral care",
  planning: "Planning",
  reporting: "Reporting",
};

export const PURPOSE_LINES: Record<PurposeKey, string> = {
  pastoral_care: "To look after the people in it: calls, visits, prayer.",
  planning: "To plan meetings, seats and next steps.",
  reporting: "To report on the tribe or the programme to those who ask.",
};
