import { whatsappTemplateName } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";

/**
 * Meta's name for a wording and the site's message types that go out under it. A reminder that reuses another message's wording (whatsappAs) is under that
 * wording's name, so when Meta files a wording as Marketing, every message type that uses it is held back from WhatsApp together.
 */
export function keysForTemplateName(name: string): string[] {
  const keys: string[] = [];
  for (const def of Object.values(TEMPLATES)) {
    if (def.emailOnly) continue;
    if (whatsappTemplateName(def.whatsappAs ?? def.key) === name) keys.push(def.key);
  }
  return keys.sort();
}

/** Every message type that goes out under one of these Meta names. */
export function keysForTemplateNames(names: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const name of names) for (const key of keysForTemplateName(name)) out.add(key);
  return [...out].sort();
}
