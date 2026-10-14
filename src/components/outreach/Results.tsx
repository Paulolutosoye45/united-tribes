import { LEFT_OUT_REASONS } from "@/lib/outreach/labels";
import type { BroadcastResults } from "@/lib/outreach/types";

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** What happened, in plain numbers. Counts only: nobody is named, and "tapped" counts people who opened the page the button leads to. */
export function Results({ r }: { r: BroadcastResults }) {
  const left = Object.entries(r.left_out).filter(([, n]) => n > 0);
  const tiles = [
    { label: "People it was for", value: r.frozen, note: "Fixed when it was approved" },
    { label: "Sent", value: r.sent, note: r.waiting > 0 ? `${r.waiting.toLocaleString("en")} still to go` : "All done" },
    { label: "Reached", value: r.delivered, note: `${pct(r.delivered, r.sent)}% of those sent` },
    { label: "Tapped the button", value: r.tapped, note: `${pct(r.tapped, r.delivered || r.sent)}% of those reached` },
    { label: "Stopped announcements", value: r.unsubscribed, note: r.sent > 0 ? `${((r.unsubscribed / r.sent) * 100).toFixed(1)}% of those sent` : "" },
    { label: "Did not arrive", value: r.bounced, note: "Address did not work" },
  ];
  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4" data-testid="results">
      <h2 id="results-heading" className="t-heading">
        How it went
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label} className="card flex flex-col gap-0.5 p-4">
            <span className="t-small text-soft">{t.label}</span>
            <span className="t-title">{t.value.toLocaleString("en")}</span>
            <span className="t-small text-soft">{t.note}</span>
          </li>
        ))}
      </ul>
      {left.length > 0 ? (
        <p className="t-small text-soft">
          Left out: {left.map(([k, n]) => `${n.toLocaleString("en")} ${(LEFT_OUT_REASONS[k] ?? k).toLowerCase()}`).join(", ")}.
        </p>
      ) : null}
      <p className="t-small text-soft">
        We do not track opens. “Tapped” counts people who followed the button to United Tribes.
        {r.final_at ? ` These numbers are final after ${new Date(r.final_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, and the wording is cleared 90 days after it goes.` : ""}
      </p>
    </section>
  );
}
