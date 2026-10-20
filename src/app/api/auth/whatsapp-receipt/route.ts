import { handleReceipt } from "@/lib/signin/linked-route";

export const dynamic = "force-dynamic";

/** A delivery receipt for a sign-in code, passed on by the sender service. Signed with LINKED_SENDER_SECRET. */
export async function POST(request: Request) {
  return handleReceipt(request);
}
