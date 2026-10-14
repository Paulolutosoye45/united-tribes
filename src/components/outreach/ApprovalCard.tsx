import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { announcementSpec } from "@/lib/outreach/compose";
import { BUTTON_TARGETS } from "@/lib/outreach/labels";
import type { ApprovalRow } from "@/lib/outreach/types";
import { ApproveControls } from "./AnnouncementActions";
import { EmailFrame } from "./EmailFrame";

/** One announcement waiting for a second person: exactly what will be read, who for, how many, and who wrote it. */
export function ApprovalCard({ row, site, church }: { row: ApprovalRow; site: string; church: { name: string; address: string } }) {
  const spec = announcementSpec(
    { subject: row.subject, paragraphs: row.paragraphs, button_label: row.button_label, button_target: row.button_target },
    row.sample ?? { first_name: "Adaeze", tribe: "Builders Tribe", season_starts: "9 February 2027", my_page: "/home" },
    site,
    church,
  );
  const target = BUTTON_TARGETS.find((t) => t.value === row.button_target)?.label;
  return (
    <article className="card flex flex-col gap-6 p-5 sm:p-6" data-testid="approval-card" aria-labelledby={`ap-${row.id}`}>
      <header className="flex flex-col gap-1">
        <h2 id={`ap-${row.id}`} className="t-heading">
          {row.title}
        </h2>
        <p className="t-small text-soft">
          Written by {row.created_by ?? "someone"} · for {row.audience_label} · <strong className="text-ink">{row.count.toLocaleString("en")} people</strong>
          {row.scheduled_for ? ` · goes ${formatLagosDay(row.scheduled_for)}, ${formatLagosTime(row.scheduled_for)}` : ""}
        </p>
        {target ? <p className="t-small text-soft">Button “{row.button_label}” opens: {target}.</p> : null}
      </header>
      <EmailFrame spec={spec} label={`Preview of ${row.title}`} />
      <ApproveControls id={row.id} mine={row.mine} />
    </article>
  );
}
