import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canOpen } from "@/lib/guides/access";
import { guideBySlug } from "@/lib/guides/catalogue";
import { pictureOf } from "@/lib/guides/pictures";

export const dynamic = "force-dynamic";

const BASE = path.join(process.cwd(), "content", "guides", "pictures");
const NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;

/**
 * A guide's picture, served only to someone who may open the guide it belongs to: the same rule as the guide itself. Anyone else gets the
 * same plain 404 as a picture that does not exist, so this never says which guides there are. The pictures are not in the public folder
 * for the same reason: nothing can fetch one without going through this check.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ guide: string; file: string }> }) {
  const { guide: slug, file } = await ctx.params;
  const missing = () => new NextResponse(null, { status: 404 });
  if (!NAME.test(slug) || !NAME.test(file)) return missing();

  const guide = guideBySlug(slug);
  const picture = pictureOf(slug, file);
  if (!guide || !picture) return missing();

  const session = await getSession();
  if (!canOpen(guide, session?.roles ?? null)) return missing();

  const full = path.join(BASE, slug, `${file}.webp`);
  if (!full.startsWith(BASE + path.sep)) return missing();
  let bytes: Buffer;
  try {
    bytes = await readFile(full);
  } catch {
    return missing();
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/webp",
      "content-length": String(bytes.length),
      // The address carries a code that changes when the picture does, so it can be kept for a long time, but only on this device
      "cache-control": "private, max-age=31536000, immutable",
      etag: `"${picture.hash}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
