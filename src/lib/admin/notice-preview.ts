import { prepareParams } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { NOTICE_SAMPLES } from "@/lib/messaging/templates-notices";
import type { Context } from "@/lib/messaging/types";

export type Preview = {
  subject: string;
  greeting: string | null;
  paragraphs: string[];
  /** The button, if there is one: its words and the page it opens. */
  button: { label: string; path: string } | null;
  /** The parts of a summary, one for each role. */
  sections: { title: string; items: { label: string; note: string }[] }[];
};

const SITE = "https://unitedtribes.example";
const CONTEXT: Context = { site: SITE, first: "Ada", link: (path) => `${SITE}${path.startsWith("/") ? path : `/${path}`}`, reply: () => null };

/**
 * How one notice reads, with made-up names and numbers, for the Notifications page. It is built by the template that sends the real email,
 * so what the office reads here is what the team gets. Nothing in it comes from a real person.
 */
export function previewOf(key: string): Preview | null {
  const def = TEMPLATES[key];
  const sample = NOTICE_SAMPLES[key];
  if (!def || !sample) return null;
  try {
    const content = def.email(prepareParams(sample), CONTEXT);
    return {
      subject: content.subject,
      greeting: content.greeting ?? null,
      paragraphs: content.paragraphs,
      button: content.cta ? { label: content.cta.label, path: content.cta.url.replace(SITE, "") || "/" } : null,
      sections: (content.sections ?? []).map((s) => ({ title: s.title, items: s.items.map((i) => ({ label: i.label, note: i.note ?? "" })) })),
    };
  } catch {
    return null;
  }
}
