import { handleInbound } from "@/lib/signin/linked-route";

export const dynamic = "force-dynamic";

/**
 * A message someone sent to the sign-in number, passed on by the sender service (see /sender). Signed with
 * LINKED_SENDER_SECRET. The answer says what, if anything, the number should reply with.
 */
export async function POST(request: Request) {
  return handleInbound(request);
}
