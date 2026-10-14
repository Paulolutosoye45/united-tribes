/**
 * Which way to get a code (email or WhatsApp) the person used last on this device. A convenience only: nothing ever
 * depends on it. Storage can be missing, full or blocked (private windows, strict settings), so every call is
 * guarded and a failure simply means "no remembered choice". A first visit has none, and starts on email.
 */
export type SignInTab = "email" | "whatsapp";

export const CHOICE_KEY = "ut.signin.tab";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChoice(store: Store | null = browserStore()): SignInTab | null {
  try {
    const value = store?.getItem(CHOICE_KEY);
    return value === "email" || value === "whatsapp" ? value : null;
  } catch {
    return null;
  }
}

export function writeChoice(tab: SignInTab, store: Store | null = browserStore()): void {
  try {
    store?.setItem(CHOICE_KEY, tab);
  } catch {
    // Nothing to do: the choice is only remembered when the device allows it.
  }
}
