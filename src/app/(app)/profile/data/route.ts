import { getSession } from "@/lib/auth/session";
import { openPrivate } from "@/lib/intake/server";
import { buildExport, exportFilename } from "@/lib/privacy/export";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * "Download my data": everything the platform holds about the signed-in person, as one file. It is only ever the
 * caller's own (the database answers for the person the session belongs to), it is never cached, and another site
 * cannot trigger it for a signed-in visitor.
 */
export async function GET(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("Open this from your own profile page.", { status: 403, headers: NO_STORE });
  }
  const session = await getSession();
  if (!session) return new Response("Sign in first.", { status: 401, headers: NO_STORE });

  const supabase = await createClient();
  const [data, sealed, profile] = await Promise.all([
    supabase.rpc("export_my_data"),
    supabase.from("member_profiles").select("support_enc, leader_note_enc").eq("person_id", session.person.id).maybeSingle(),
    // My page's part of the file. A database that does not have it yet answers with an error, and the file is then exactly what it was.
    supabase.rpc("my_profile_export"),
  ]);
  if (data.error || !data.data || typeof data.data !== "object") {
    return new Response("We couldn’t put your file together. Please try again in a moment.", { status: 502, headers: NO_STORE });
  }

  const notes = sealed.data ? openPrivate(sealed.data as Record<string, unknown>, session.person.id) : {};
  const body = JSON.stringify(buildExport(data.data as Record<string, unknown>, notes, profile.error ? null : profile.data), null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename()}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
