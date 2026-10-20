/**
 * What the application screens say about the steps that apply. With every step asked, each function returns exactly the words the
 * screens have always had, so nothing changes for anyone until a switch is moved.
 */
import { REQUIRED_MODES, type AcademyModes } from "@/lib/academy/modes";
import { afterDecision, approvedLine } from "@/lib/academy/wording";
import { numberWord, optionalQuestions, requiredQuestions, askedQuestions, DEFAULT_MODES, type StageModes } from "./modes";
import { ELIGIBILITY, STATUS_INFO } from "./options";

const TOTAL = ELIGIBILITY.length;

export type Para = { title: string; body: string };

/** The four things on the first screen that say how it works. */
export function welcomeStages(modes: StageModes = DEFAULT_MODES, training: AcademyModes = REQUIRED_MODES): Para[] {
  const out: Para[] = [{ title: "This application", body: "Eight written answers and six situations. About fifteen minutes, and you can stop and come back." }];
  if (modes.references === "required") {
    out.push({
      title: "Two referees",
      body: "Two people who have seen you serve answer four questions about you. We send each of them their own private link. One is a pastor or unit head.",
    });
  } else if (modes.references === "optional") {
    out.push({
      title: "Referees, if you like",
      body: "You can add up to two people who have seen you serve. If you do, they answer four questions about you and we send each of them their own private link. It is your choice.",
    });
  }
  if (modes.interview === "required") {
    out.push({ title: "Panel and interview", body: "Two reviewers read your answers. If you are invited, you have a 20-minute conversation." });
  } else if (modes.interview === "optional") {
    out.push({ title: "Panel and interview", body: "Two reviewers read your answers. You may be invited to a 20-minute conversation." });
  } else {
    out.push({ title: "Panel review", body: "Two reviewers read your answers." });
  }
  out.push({ title: "A pastor decides", body: `You see the result here, with a short note.${afterDecision(training) ? ` ${afterDecision(training)}` : ""}` });
  return out;
}

/** The heading and the line under it on the questions screen. */
export function eligibilityHeading(modes: StageModes = DEFAULT_MODES): Para {
  const asked = askedQuestions(modes).length;
  const optional = optionalQuestions(modes).length;
  const required = requiredQuestions(modes).length;
  const everyYes = "Every answer needs to be yes to lead. If one is not yet, we will point you to another way to serve.";
  if (asked === TOTAL && optional === 0) return { title: "First, seven quick questions.", body: everyYes };
  const title = `First, ${numberWord(asked)} quick ${asked === 1 ? "question" : "questions"}.`;
  if (optional === 0) return { title, body: everyYes };
  if (required === 0) return { title, body: "These help us get to know you. A “Not yet” on any of them will not stop your application." };
  return {
    title,
    body: "The ones marked required need a yes to lead. If one of those is not yet, we will point you to another way to serve. A “Not yet” on the others will not stop you.",
  };
}

/** The note at the foot of the review screen. */
export function reviewFooter(modes: StageModes = DEFAULT_MODES): string {
  const tail =
    modes.interview === "required"
      ? "Then you are invited to a 20-minute interview, and a pastor decides."
      : modes.interview === "optional"
        ? "You may be invited to a 20-minute interview, and then a pastor decides."
        : "Then a pastor decides.";
  if (modes.references === "required") {
    return `After you send it, you press “Send request” for each referee and we send them a private link and a code. You never see the link. The panel reads your application while they answer.${
      modes.interview === "off" ? "" : " An interview invitation waits until both have."
    }`;
  }
  if (modes.references === "optional") {
    return `After you send it, you press “Send request” for each referee you added and we send them a private link and a code. You never see the link. The panel reads your application and does not wait for them. ${tail}`;
  }
  return `After you send it, two reviewers read your application. ${tail}`;
}

/** What the "Sent" screen says, and what its button does. */
export function submittedWording(modes: StageModes = DEFAULT_MODES, firstCheck = false, hasReferees = true): { body: string; button: string } {
  const wait = modes.references === "required" && modes.interview !== "off" ? " Interview invitations wait until both have answered." : "";
  if (modes.references === "required") {
    return firstCheck
      ? {
          body: `Your application is with us. We are reading it now, which takes a few minutes. We will message you when it is done, and then you can ask your referees.${wait}`,
          button: "See where it stands",
        }
      : {
          body: `Your application is with the panel, who can start reading it now. One more step: ask each of your referees. We send them a private link and a code ourselves.${wait}`,
          button: "Ask my referees",
        };
  }
  if (modes.references === "optional") {
    return firstCheck
      ? {
          body: "Your application is with us. We are reading it now, which takes a few minutes. We will message you when it is done, and then you can ask any referees you added.",
          button: "See where it stands",
        }
      : {
          body: hasReferees
            ? "Your application is with the panel, who can start reading it now. One more step: ask each of the referees you added. We send them a private link and a code ourselves."
            : "Your application is with the panel, who can start reading it now. A pastor will decide, and you will see the result on your Lead page.",
          button: hasReferees ? "Ask my referees" : "See where it stands",
        };
  }
  return firstCheck
    ? {
        body: "Your application is with us. We are reading it now, which takes a few minutes. We will message you when it is done.",
        button: "See where it stands",
      }
    : { body: "Your application is with the panel, who can start reading it now. A pastor will decide, and you will see the result on your Lead page.", button: "See where it stands" };
}

/** The line under the status heading on the Lead page. Only the line for "With the review panel" depends on the steps. */
export function statusLine(status: string, modes: StageModes = DEFAULT_MODES, training: AcademyModes = REQUIRED_MODES): string {
  const base = STATUS_INFO[status]?.line ?? "";
  if (status === "approved_leader" || status === "approved_assistant") return approvedLine(status, training);
  if (status !== "submitted") return base;
  const refs = modes.references === "required" ? " Send your referees their links if you have not yet." : modes.references === "optional" ? " If you added referees, send them their links if you have not yet." : "";
  const decide = modes.interview === "off" ? " A pastor will then decide, and you will see the result here." : "";
  return `Two reviewers read every application.${refs}${decide}`;
}

/** The extra line under a stage on the tracker. Missing means the stage's own description is used. */
export function stageDetails(modes: StageModes, answered: number, added: number): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  if (modes.references === "required") out.references = `${answered} of 2 answered`;
  else if (modes.references === "optional") out.references = added > 0 ? `${answered} of ${added} answered` : "Optional. Up to two people who know you answer four short questions.";
  if (modes.interview === "optional") out.interview = "Only if the panel asks for one.";
  return out;
}

/** The same, before anyone has started: only the stages that are not simply required need a line of their own. */
export function outlineDetails(modes: StageModes): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  if (modes.references === "optional") out.references = "Optional. Up to two people who know you answer four short questions.";
  if (modes.interview === "optional") out.interview = "Only if the panel asks for one.";
  return out;
}
