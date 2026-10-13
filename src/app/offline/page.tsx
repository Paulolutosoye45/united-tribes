import type { Metadata } from "next";

export const metadata: Metadata = { title: "You are offline", robots: { index: false } };

/**
 * What the phone shows when there is no connection. It has no scripts and no data of its own, so it can be kept on the
 * phone and shown at once; nothing about a person is ever stored for it.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="t-title">You are offline</h1>
      <p className="t-body text-soft">
        United Tribes needs a connection to show your tribe and your week. Nothing you have done is lost. Check your data or Wi-Fi, then try again.
      </p>
      <p>
        <a href="/home" className="inline-flex min-h-12 items-center rounded-full bg-ink px-8 font-semibold text-page">
          Try again
        </a>
      </p>
    </main>
  );
}
