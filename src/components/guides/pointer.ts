/**
 * Finding a button on the page a person is looking at, and pointing at it: a pulsing ring round the real control, with its name beside it.
 * The guides already spell every control exactly as the screen does ([[Save]], [[Record the call]]), so the same words that put a ring in a
 * picture can put one on the live page.
 *
 * Nothing here reads what a person typed or changes the page: it only measures, and draws one ring over the top.
 */

/** The same words, whatever the quotes, the capitals or the spacing. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** 3 the same words, 2 the control's name starts with the label, 1 it contains it, 0 not at all. Short labels must match whole. */
export function nameScore(name: string, label: string): 0 | 1 | 2 | 3 {
  const n = norm(name);
  const l = norm(label);
  if (!n || !l) return 0;
  if (n === l) return 3;
  if (l.length >= 4 && n.startsWith(l)) return 2;
  if (l.length >= 4 && n.includes(l)) return 1;
  return 0;
}

const CONTROLS =
  'button, a[href], [role="tab"], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], summary, label, input:not([type="hidden"]), textarea, select, h1, h2, h3';

/** The button's own pieces (the button, its sheet, the tour card, the ring) never count as part of the page being pointed at. */
const OWN = "[data-howto-ui]";

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const st = getComputedStyle(el);
  return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
}

function nameOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  if (el.matches("input, textarea, select")) {
    const field = el as HTMLInputElement;
    return field.labels?.[0]?.innerText || field.getAttribute("placeholder") || "";
  }
  return el.innerText || el.textContent || "";
}

export type Control = { el: HTMLElement; name: string };

/** What can be pressed or filled in on the screen right now, with its name. Read once, then asked about as often as needed. */
export function readControls(root: ParentNode = document): Control[] {
  const out: Control[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.closest(OWN) || !visible(el)) continue;
    const name = norm(nameOf(el));
    if (name && name.length <= 120) out.push({ el, name });
  }
  return out;
}

/** The control called this, if it is on the screen. The closest wording wins, then the one first on the page. */
export function findControl(label: string, controls: readonly Control[] = readControls()): HTMLElement | null {
  let best: { el: HTMLElement; score: number } | null = null;
  for (const c of controls) {
    const score = nameScore(c.name, label);
    if (score === 0 || (best && score <= best.score)) continue;
    best = { el: c.el, score };
    if (score === 3) break;
  }
  return best?.el ?? null;
}

/** A place in the main menu: the link on the phone's tabs or in the computer's top bar, whichever is on the screen. */
export function menuLink(href: string): HTMLElement | null {
  for (const a of document.querySelectorAll<HTMLElement>(`nav[aria-label="Main"] a[href="${CSS.escape(href)}"]`)) if (visible(a)) return a;
  return null;
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scrolls the control into the middle of the screen and rings it. The ring follows it if the page moves. It goes when the person touches the
 * screen or presses Escape, or after `ms` (0 keeps it until stopped); a `sticky` ring ignores touches and keys and stays until stopped. Returns the
 * function that takes it away.
 */
export function pointAt(el: HTMLElement, words: string, options: { ms?: number; sticky?: boolean } = {}): () => void {
  const ms = options.ms ?? 8000;
  const sticky = options.sticky === true;
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  const ring = document.createElement("div");
  ring.className = "hp-point";
  ring.setAttribute("data-howto-ui", "");
  ring.setAttribute("data-testid", "howto-point");
  ring.setAttribute("aria-hidden", "true");
  if (words) {
    const tag = document.createElement("span");
    tag.className = "hp-point-tag";
    tag.textContent = words;
    ring.appendChild(tag);
  }
  document.body.appendChild(ring);

  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const place = () => {
    const r = el.getBoundingClientRect();
    const pad = 6;
    ring.style.left = `${Math.round(r.left - pad)}px`;
    ring.style.top = `${Math.round(r.top - pad)}px`;
    ring.style.width = `${Math.round(r.width + pad * 2)}px`;
    ring.style.height = `${Math.round(r.height + pad * 2)}px`;
    ring.dataset.below = r.top < 56 ? "true" : "false";
    frame = requestAnimationFrame(place);
  };
  place();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };
  const onPointer = () => stop();
  function stop() {
    cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("keydown", onKey, true);
    ring.remove();
  }
  // (A ring that belongs to a tour stays until the tour moves on, so a tap on the tour's own buttons must not take it away.)
  if (!sticky) {
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
  }
  if (ms > 0) timer = setTimeout(stop, ms);
  return stop;
}
