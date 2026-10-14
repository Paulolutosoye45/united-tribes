"use client";

import type { Done } from "@/lib/admin/rpc";
import type { Result } from "@/lib/admin/types";

/** Turns an action that hands data back into the plain yes-or-no `useDo` expects, keeping the data for the caller. */
export function keep<T>(act: () => Promise<Done<T>>, into: (data: T) => void): () => Promise<Result> {
  return async () => {
    const done = await act();
    if (!done.ok) return done;
    into(done.data);
    return { ok: true };
  };
}
