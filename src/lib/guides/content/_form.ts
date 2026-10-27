import type { Action, Finder } from "../types";

/**
 * How a person walks the Find your tribe form, screen by screen. A picture of a late screen has to arrive there the way a person does,
 * so each guide step names the screen it shows and gets the actions that lead to it. The answers are made up.
 */
const choice = (name: string, value: string): Finder => ({ css: `label.choice:has(input[name="${name}"][value="${value}"])` });
const heading = (name: string): Finder => ({ role: "heading", name });

type Screen = { id: string; heading: string | RegExp; answer: Action[]; go: string };

export const FORM_SCREENS: Screen[] = [
  {
    id: "welcome",
    heading: "Let’s find your tribe.",
    answer: [
      { do: "click", on: choice("consent-matching", "yes") },
      { do: "click", on: choice("consent-ai", "yes") },
    ],
    go: "I agree, let’s begin",
  },
  { id: "age", heading: "How old are you?", answer: [{ do: "click", on: choice("age", "33-40") }], go: "Continue" },
  {
    id: "name",
    heading: "What should we call you?",
    answer: [
      { do: "fill", on: { label: "First name or what you go by" }, value: "Tolu" },
      { do: "fill", on: { label: "Full name" }, value: "Tolu Example" },
    ],
    go: "Continue",
  },
  {
    id: "gender",
    heading: "Which describes you?",
    answer: [
      { do: "click", on: choice("gender", "male") },
      { do: "click", on: choice("tribeMix", "mixed") },
    ],
    go: "Continue",
  },
  {
    id: "where",
    heading: "Where are you based?",
    answer: [
      { do: "fill", on: { role: "combobox", name: /./ }, value: "Yab" },
      { do: "click", on: { role: "option", name: /Yaba/ } },
    ],
    go: "Continue",
  },
  {
    id: "story",
    heading: "Tell us about your season.",
    answer: [
      {
        do: "fill",
        on: { css: "textarea[name=story]" },
        value: "I am married with two small kids and I work in a bank in Yaba. I want to grow at work without losing my peace.",
      },
    ],
    go: "Continue",
  },
  { id: "heard", heading: "Here is what we heard.", answer: [{ do: "wait", on: { role: "button", name: /^Married/ } }, { do: "pause", ms: 1200 }], go: "Continue" },
  { id: "community", heading: "Which community feels like home right now?", answer: [{ do: "click", on: choice("community", "professionals") }, { do: "wait", on: heading("A second choice?") }], go: "Continue" },
  { id: "faith", heading: "Where are you on your walk with God?", answer: [{ do: "click", on: choice("faith", "growing") }], go: "Continue" },
  { id: "goal", heading: "What do you want to move forward this season?", answer: [{ do: "click", on: choice("goal", "step-into-a-leadership-role") }], go: "Continue" },
  { id: "success", heading: "In twelve weeks, what would you love to say?", answer: [{ do: "pause", ms: 1500 }, { do: "click", on: { css: 'label:has(input[name="baseline"][value="3"])' } }], go: "Continue" },
  {
    id: "rhythm",
    heading: "How and when could you meet?",
    answer: [{ do: "click", on: { within: { role: "radiogroup", name: "How you would like to meet" }, text: "Online", exact: true } }, { do: "click", on: choice("times", "weeknight-evening") }, { do: "pause", ms: 700 }],
    go: "Continue",
  },
  { id: "style", heading: "This or that?", answer: [{ do: "pause", ms: 300 }], go: "Continue" },
  { id: "care", heading: "Anything you would like us to know?", answer: [], go: "Skip for now" },
  { id: "reach", heading: "How should we reach you?", answer: [{ do: "fill", on: { css: 'input[name="phone"]' }, value: "0803 000 0000" }], go: "Continue" },
  { id: "review", heading: "Here is what we have.", answer: [], go: "Save my answers" },
];

/** The actions that take a person from the first screen of the form to the screen called `id`, answering what is asked on the way. */
export function formTo(id: string): Action[] {
  const at = FORM_SCREENS.findIndex((s) => s.id === id);
  if (at < 0) throw new Error(`the form has no screen called ${id}`);
  const out: Action[] = [];
  for (let i = 0; i < at; i++) {
    const screen = FORM_SCREENS[i];
    out.push(...screen.answer, { do: "click", on: { role: "button", name: screen.go } }, { do: "wait", on: heading(FORM_SCREENS[i + 1].heading as string) });
  }
  return out;
}
