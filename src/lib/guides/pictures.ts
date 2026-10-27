import manifest from "./pictures.generated.json";
import type { GuideManifest, PictureInfo } from "./types";

/** What the picture maker recorded: every picture's size, where its ring sits, and when the guide's pictures were last made. */
export const PICTURES = manifest as unknown as GuideManifest;

export const pictureOf = (slug: string, stepId: string): PictureInfo | null => PICTURES[slug]?.pictures[stepId] ?? null;

/** The address of a picture. The code on the end changes when the picture does, so a phone never shows an old one. */
export const pictureUrl = (slug: string, p: Pick<PictureInfo, "id" | "hash">) => `/guides/p/${slug}/${p.id}?v=${p.hash}`;

/** The day a guide's pictures were last made, as "26 October 2026", or null if none were made. */
export function madeOnLabel(slug: string): string | null {
  const day = PICTURES[slug]?.madeOn;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
