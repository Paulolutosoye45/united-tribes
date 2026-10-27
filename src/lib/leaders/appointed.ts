import { needsOf, REQUIRED_MODES, trainingShown, type AcademyModes } from "@/lib/academy/modes";
import { trainingAsk } from "@/lib/academy/wording";
import type { CertState } from "@/lib/academy/types";
import type { StageState } from "./status";

/**
 * A leader the church appointed has no application, so the Lead page cannot tell the story an application tells. This is the story
 * that is true for them: they are appointed, and what is left is training, a Tribe Card a pastor approves, and then members.
 *
 * It never says who appointed them. The database does not tell this page, and nothing here could say it.
 */

export type MyAppointment = {
  /** The name of the Tribe Card started for them. Null when there is none yet or it has no name. */
  tribeName: string | null;
  /** Where that card stands. Null when there is no card. */
  tribeStatus: "draft" | "submitted" | "changes_requested" | "approved" | null;
  certified: boolean;
};

const CARD_STATUSES = ["draft", "submitted", "changes_requested", "approved"] as const;

/** Reads what the database gives (my_appointment). Null when there is no appointment or the answer is not in the shape expected. Never throws. */
export function parseMyAppointment(raw: unknown): MyAppointment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const name = typeof v.tribe_name === "string" && v.tribe_name.trim() !== "" && v.tribe_name.length <= 120 ? v.tribe_name.trim() : null;
  const status = (CARD_STATUSES as readonly unknown[]).includes(v.tribe_status) ? (v.tribe_status as MyAppointment["tribeStatus"]) : null;
  return { tribeName: name, tribeStatus: status, certified: v.certified === true };
}

/**
 * Whether everything the training asks of them is done: the modules, the declaration and the practice, each only where it is asked for.
 * Certification also waits for a pastor to approve the Tribe Card, so someone can be done with training and not yet certified.
 * With no training to do (both switches off) there is nothing to be done with, and this is false.
 */
export function trainingFinished(state: Pick<CertState, "modules_done" | "declaration" | "practice"> & Partial<CertState>, m: AcademyModes = REQUIRED_MODES): boolean {
  if (!trainingShown(m)) return false;
  const need = needsOf(state);
  return (!need.modules || state.modules_done) && (!need.declaration || state.declaration) && (!need.practice || state.practice);
}

/** The heading: the tribe's name when it has one. */
export function appointedTitle(a: MyAppointment): string {
  return a.tribeName ? `You have been appointed to lead ${a.tribeName}.` : "You have been appointed to lead.";
}

/** The sentence under the heading. It follows the Academy and declaration switches, in the same words the approval line uses. */
export function appointedLine(a: MyAppointment, m: AcademyModes = REQUIRED_MODES, trainingDone = false): string {
  const cardDone = a.tribeStatus === "approved";
  if (cardDone && a.certified) return "Your Tribe Card is approved and you are certified, so members can find your tribe.";
  if (cardDone) return "Your Tribe Card is approved. Members can find your tribe once you are certified.";
  if (a.certified) return "You are certified. Your Tribe Card is next, and a pastor approves it before members can find your tribe.";
  if (trainingDone && trainingShown(m)) return "Your training is done. Your Tribe Card is next, and a pastor approves it before members can find your tribe.";
  const intro = "Welcome. You have been appointed to lead, so there is no application to complete.";
  if (m.academy === "required") return `${intro} Leader training is next.`;
  if (m.academy === "optional") {
    return m.declaration === "required"
      ? `${intro} Leader training is optional, and there is a short safeguarding declaration to sign.`
      : `${intro} Leader training is optional.`;
  }
  if (m.declaration === "required") return `${intro} A short safeguarding declaration is next.`;
  return `${intro} Your Tribe Card is next.`;
}

export type AppointedStep = { id: "appointed" | "training" | "card" | "open"; label: string; blurb: string; state: StageState };

const CARD_BLURB: Record<NonNullable<MyAppointment["tribeStatus"]>, string> = {
  draft: "Started for you. Check it, then send it to a pastor.",
  submitted: "With a pastor for approval.",
  changes_requested: "A pastor asked for changes. Open it to see what to change.",
  approved: "Approved by a pastor.",
};

/** The four steps that are true for an appointed leader. A step that is not part of the process (no training asked for) is "off" and left out of the path. */
export function appointedSteps(a: MyAppointment, m: AcademyModes = REQUIRED_MODES, trainingDone = false): AppointedStep[] {
  const cardDone = a.tribeStatus === "approved";
  const shown = trainingShown(m);
  const trained = a.certified || trainingDone;
  return [
    { id: "appointed", label: "Appointed", blurb: "You were appointed to lead. There is no application or interview.", state: "done" },
    {
      id: "training",
      label: m.academy === "off" ? "Safeguarding declaration" : "Leader training",
      blurb: a.certified ? "Done. You are certified." : trained ? "Done. Certification follows once a pastor approves your Tribe Card." : (trainingAsk(m) ?? "Nothing is asked here."),
      state: !shown ? "off" : trained ? "done" : "current",
    },
    { id: "card", label: "Tribe Card", blurb: CARD_BLURB[a.tribeStatus ?? "draft"], state: cardDone ? "done" : "current" },
    {
      id: "open",
      label: "Open to members",
      blurb: cardDone && a.certified ? "Members can now find your tribe." : "Opens once your Tribe Card is approved and you are certified.",
      state: cardDone && a.certified ? "done" : "later",
    },
  ];
}
