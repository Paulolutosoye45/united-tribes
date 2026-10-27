import type { Role } from "@/lib/auth/roles";

/**
 * The How-to Library, as data.
 *
 * A guide is a list of steps. Each step says what to do in a few short lines and, where a screen helps, how to arrive at that screen
 * (a "shot"). The same list is read by two programs:
 *   - the website, which shows the words and the picture, and
 *   - the picture maker (e2e/pictures/guides.ts), which opens a throwaway copy of the site, follows the shot, rings the thing to press
 *     and saves the picture. It stops if what a step names is not on the screen, so a picture can never show something the words do not say.
 *
 * Words use two marks: **bold** for a thing to notice, and [[Label]] for a button, link, field or heading exactly as the screen spells it.
 * The picture maker checks every [[Label]] on the screen it pictured.
 */

/** Something on a screen, found the way a person would find it: by what it says. */
export type Finder =
  | { role: "button" | "link" | "heading" | "textbox" | "checkbox" | "radio" | "combobox" | "tab" | "option" | "radiogroup" | "group"; name: string | RegExp; exact?: boolean }
  | { label: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { css: string; nth?: number }
  | { testid: string }
  /** Words inside something else: the "Online" inside the group called "How you would like to meet". */
  | { within: Finder; text: string; exact?: boolean };

/** One thing a person does on the way to the screen: the picture maker does it too. */
export type Action =
  | { do: "click"; on: Finder }
  | { do: "fill"; on: Finder; value: string }
  /** Types the six-digit code the church just emailed to this made-up address (the picture maker reads it from the test mailbox). */
  | { do: "fill-code"; on: Finder; to: string }
  | { do: "check"; on: Finder }
  | { do: "wait"; on: Finder }
  | { do: "open"; path: string }
  | { do: "pause"; ms: number };

/** Who is signed in while the picture is made. Each is a made-up person, set up by the picture maker. */
export type Cast =
  | "visitor"
  | "new-member"
  | "member"
  | "tribe-member"
  | "member-leaving"
  | "applicant"
  | "leader-in-training"
  | "leader"
  | "appointed-leader"
  | "assistant"
  | "pastor"
  | "director"
  | "admin"
  | "coach"
  | "care-lead"
  | "champion"
  | "data-lead"
  | "referee"
  | "parent"
  | "placed";

export type Shot = {
  cast: Cast;
  /** The page to open. For a link in an email it is a name the picture maker knows, such as "@referee". */
  path: string;
  /** Names a ready-made situation the picture maker sets up before the page opens (for example "member-has-tribe"). */
  arrange?: string;
  /** How to bring the page to the state shown, after it opens. */
  before?: Action[];
  /** What to ring. One finder rings one thing; several ring the box that holds them all. */
  ring: Finder[];
  /** A second, quieter ring (gold), for "this changes too". */
  second?: Finder[];
  /** A short label on the ring, such as "Press here". */
  tag?: string;
  /** Phone is the default. Office guides use a computer-sized screen. */
  device?: "phone" | "desktop";
  /** "crop" (the default) shows the part of the page round the ring; "screen" shows the whole window. */
  frame?: "crop" | "screen";
  /** How far above the ring the crop starts, in pixels of the page. Default 96. */
  lead?: number;
  /** Minimum height of the crop in pixels of the page. Default 300 on a phone. */
  minHeight?: number;
  /** For a person who cannot see the picture. */
  alt: string;
};

export type Timeline = { when: string; what: string }[];

export type Step = {
  /** Lower-case words and dashes. It is the picture's file name and the link to this step (#id). */
  id: string;
  title: string;
  /** What to do, one short line each. 1 to 3 lines. */
  do: string[];
  tip?: string;
  /** A reason, for a step people skip. */
  why?: string;
  /** What not to do or what to watch for. */
  careful?: string;
  /** A made-up example of what to write. */
  example?: string;
  shot?: Shot;
  /** A "what happens when" strip, for the part after the last step. */
  timeline?: Timeline;
};

export type Part = { title: string; blurb?: string; steps: Step[] };

export type Guide = {
  /** Short code used in the plan: M1, L3, P2. */
  code: string;
  slug: string;
  title: string;
  /** One sentence under the title. */
  lede: string;
  /** Who it is for, in words ("For tribe leaders"). */
  forWho: string;
  /** Anyone holding one of these roles may open it. Everyone with an account holds "member". */
  audience: readonly Role[];
  /**
   * Other roles that may also open it, because what they do touches it, and who see it on the "what others see" shelf.
   * They are not listed first for them.
   */
  seenBy?: readonly Role[];
  /** Opens for anyone with the link, signed in or not (sign-in help, and the pages people reach from an email). */
  public?: boolean;
  /** About how many minutes it takes to read and do. */
  minutes: number;
  /** At most four things to have ready. */
  ready: string[];
  parts: Part[];
  /** One line: where to turn when the screen looks different. */
  ifDifferent: string;
  /** Who else sees what you just did (office guides). */
  whoSees?: string[];
  /** Slugs of the guides to offer after this one. */
  next?: string[];
  /** A word for the card art. */
  art: ArtKind;
  /** Shown on the cover: a returning person can jump past the first part. */
  shortcut?: { label: string; toStep: string };
};

export type ArtKind = "sign-in" | "form" | "tribe" | "week" | "testimony" | "privacy" | "apply" | "wait" | "learn" | "run" | "season" | "appointed" | "assist" | "reference" | "consent" | "placed" | "decide" | "card" | "ready" | "invite" | "offer" | "move" | "today" | "checklist" | "people" | "send" | "notice" | "request" | "log" | "review" | "care" | "call" | "community" | "chart" | "watch";

/** A picture as the picture maker recorded it, and as the page shows it. */
export type PictureInfo = {
  /** File name without the extension. Same as the step id. */
  id: string;
  width: number;
  height: number;
  /** A short code for the picture's content, so the browser fetches it again when it changes. */
  hash: string;
  device: "phone" | "desktop";
  /** Where the ring sits, as percentages of the picture. */
  rings: { x: number; y: number; w: number; h: number; tone: "main" | "second" }[];
  /** The tag's anchor, in percentages: the top right of the main ring. */
  tag?: { text: string; x: number; y: number };
};

export type GuideManifest = Record<string, { madeOn: string; pictures: Record<string, PictureInfo> }>;
