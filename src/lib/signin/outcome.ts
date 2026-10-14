/** What a server flow hands its route: the HTTP status and the JSON to send. Kept apart from Request/Response so flows are easy to test. */
export type Outcome = { status: number; body: unknown };

export const NO_STORE = { "cache-control": "no-store" } as const;

export function respond(outcome: Outcome): Response {
  return Response.json(outcome.body, { status: outcome.status, headers: NO_STORE });
}

/** The shape the sign-in service expects back from its hook when something goes wrong. */
export function hookFailure(status: number, message: string): Outcome {
  return { status, body: { error: { http_code: status, message } } };
}

export const last4 = (digits: string) => `***${digits.slice(-4)}`;
