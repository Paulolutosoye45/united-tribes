import { BROADCAST_STATUS } from "@/lib/outreach/labels";

const TONES = {
  grey: "bg-surface-strong text-ink",
  amber: "bg-gold/30 text-ink",
  green: "bg-success/15 text-success",
  red: "bg-danger/15 text-danger",
  blue: "bg-flame/15 text-flame-deep",
} as const;

export function StatusBadge({ status }: { status: string }) {
  const s = BROADCAST_STATUS[status] ?? { label: status, tone: "grey" as const };
  return <span className={`inline-flex rounded-full px-3 py-1 text-[0.8rem] font-semibold ${TONES[s.tone]}`}>{s.label}</span>;
}
