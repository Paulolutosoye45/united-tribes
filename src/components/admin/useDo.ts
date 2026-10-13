"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Result } from "@/lib/admin/types";

/**
 * One thing at a time: runs an action, shows why it failed or that it worked, and refreshes the page's data.
 * `key` names what is running, so a screen with many buttons can show which one is busy.
 */
export function useDo() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function go(key: string, act: () => Promise<Result>, opts: { saved?: string; after?: () => void } = {}): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setError(null);
    setSaved(null);
    let result: Result;
    try {
      result = await act();
    } catch {
      result = { ok: false, message: "We couldn’t save that. Check your connection and try again." };
    }
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    if (opts.saved) setSaved(opts.saved);
    opts.after?.();
    router.refresh();
    return true;
  }

  const clear = () => {
    setError(null);
    setSaved(null);
  };

  return { busy, error, saved, go, clear };
}
