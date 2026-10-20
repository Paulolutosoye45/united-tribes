import { academyOpen, trainingShown, type AcademyModes } from "./modes";

/**
 * The words about training, for the places that talk about it before a leader is in the Academy: the Lead page, the approval
 * line and the buttons. With the Academy and the declaration both required every line is the line it has always been.
 */

/** The line in "What it asks of you" on the Lead page. Empty when there is no training to ask for. */
export function trainingAsk(m: AcademyModes): string | null {
  if (m.academy === "required") return "About 10 hours of training before your tribe begins, with a safeguarding course.";
  if (m.academy === "optional") {
    return m.declaration === "required"
      ? "Training is on offer before your tribe begins, and it is optional. You will sign a short safeguarding declaration."
      : "Training is on offer before your tribe begins, and it is optional.";
  }
  return m.declaration === "required" ? "A short safeguarding declaration to sign before your tribe begins." : null;
}

/** The sentence under the heading once an application is approved. */
export function approvedLine(status: "approved_leader" | "approved_assistant", m: AcademyModes): string {
  const leader = status === "approved_leader";
  if (m.academy === "required") return leader ? "Welcome. Leader training is next." : "Welcome. You will serve beside a leader. Training is next.";
  const lead = leader ? "Welcome." : "Welcome. You will serve beside a leader.";
  if (m.academy === "optional") {
    return m.declaration === "required"
      ? `${lead} Leader training is optional, and there is a short safeguarding declaration to sign.`
      : `${lead} Leader training is optional.`;
  }
  if (m.declaration === "required") return `${lead} A short safeguarding declaration is next.`;
  return leader ? `${lead} Your Tribe Card is next.` : lead;
}

/** The button that leads into training from the Lead page, or null when there is none to show. */
export function trainingButton(m: AcademyModes): { label: string; href: string } | null {
  if (!trainingShown(m)) return null;
  return academyOpen(m) ? { label: "Open my training", href: "/lead/academy" } : { label: "Sign the safeguarding declaration", href: "/lead/academy/declaration" };
}

/** The line on the first screen of the application that says what leading asks of a person. */
export function welcomeAsk(m: AcademyModes): string {
  const time = "75 minutes a week for 12 weeks";
  if (m.academy === "required") return `What it asks of you: ${time}, plus about 10 hours of training before your tribe begins.`;
  if (m.academy === "optional") {
    return m.declaration === "required"
      ? `What it asks of you: ${time}, and a short safeguarding declaration to sign. Training is on offer before your tribe begins, and it is optional.`
      : `What it asks of you: ${time}. Training is on offer before your tribe begins, and it is optional.`;
  }
  return m.declaration === "required" ? `What it asks of you: ${time}, and a short safeguarding declaration to sign before your tribe begins.` : `What it asks of you: ${time}.`;
}

/** The sentence after "A pastor decides" that says what follows. Empty when nothing is asked of a leader after the decision. */
export function afterDecision(m: AcademyModes): string {
  if (m.academy === "required") return "Training follows.";
  if (m.academy === "optional") return m.declaration === "required" ? "Optional training and a short safeguarding declaration follow." : "Optional training follows.";
  return m.declaration === "required" ? "A short safeguarding declaration follows." : "";
}
