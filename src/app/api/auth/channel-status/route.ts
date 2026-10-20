import { currentChannel } from "@/lib/signin/deps";
import { NO_STORE } from "@/lib/signin/outcome";

export const dynamic = "force-dynamic";

/** Whether WhatsApp sign-in is on, off or paused, and how it works. Nothing else: no counts, no reasons. */
export async function GET() {
  const channel = await currentChannel();
  return Response.json(channel, { headers: NO_STORE });
}
