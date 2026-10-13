import { NextResponse } from "next/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * A portrait, served only to people the database lets see it: the person themselves, members looking at a
 * tribe leader's card, a leader's own tribe, and the staff who run the programme. The database decides;
 * this route only turns what it returns back into an image. Anyone else gets the same plain 404 as a missing
 * picture, so the route never says whether a person has one.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("photo_of", { p_person: id });
  if (error || !data) return new NextResponse(null, { status: error?.code === "42501" ? 401 : 404 });

  const photo = data as { mime: string; data: string };
  if (!["image/jpeg", "image/png", "image/webp"].includes(photo.mime)) return new NextResponse(null, { status: 404 });
  const bytes = Buffer.from(photo.data, "base64");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": photo.mime,
      "content-length": String(bytes.length),
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
