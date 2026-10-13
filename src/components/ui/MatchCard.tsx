import { ShieldMeter, METER_COLORS } from "@/components/brand/ShieldMeter";
import type { MeterPart } from "@/components/brand/ShieldMeter";
import { Button } from "./Button";

export type MatchCardData = {
  tribeName: string;
  community: string;
  track: string;
  goal: string;
  leaderFirstName: string;
  leaderLine: string;
  meeting: string;
  seatsLeft: number;
  /** 0 to 100 */
  degree: number;
  reasons: string[];
  parts: [MeterPart, MeterPart, MeterPart, MeterPart];
};

export function fitLabel(degree: number): string {
  if (degree >= 85) return "Excellent fit";
  if (degree >= 70) return "Strong fit";
  return "Good fit";
}

export function MatchCard({
  data,
  onChoose,
  rank,
}: {
  data: MatchCardData;
  onChoose?: () => void;
  rank?: number;
}) {
  return (
    <article
      className="rounded-[var(--radius-sheet)] border border-line bg-page p-5 sm:p-6"
      aria-label={`${data.tribeName}, ${data.degree}% compatible`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="t-small text-soft">
            {rank ? `Match ${rank}` : data.community} · {data.track}
          </p>
          <h3 className="t-heading mt-1">{data.tribeName}</h3>
          <p className="t-small mt-1 text-soft">Season goal: {data.goal}</p>
        </div>
        <ShieldMeter parts={data.parts} size={64} />
      </div>

      <div className="mt-4 flex items-end gap-3">
        <span className="t-figure" aria-hidden="true">
          {data.degree}
          <span className="text-[0.4em] align-top">%</span>
        </span>
        <span className="t-small pb-1.5 font-semibold text-accent">{fitLabel(data.degree)}</span>
      </div>

      <ul className="mt-4 space-y-1.5 text-[0.95rem]">
        {data.reasons.map((r) => (
          <li key={r} className="flex gap-2.5">
            <span aria-hidden="true" className="mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full bg-flame" />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-4 text-[0.9rem]">
        <dt className="text-soft">Leader</dt>
        <dd className="font-medium">{data.leaderFirstName}</dd>
        <dt className="text-soft">Meets</dt>
        <dd className="font-medium">{data.meeting}</dd>
        <dt className="text-soft">Seats left</dt>
        <dd className="font-medium">{data.seatsLeft}</dd>
      </dl>
      <p className="t-small mt-3 text-soft">{data.leaderLine}</p>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1" aria-label="What makes up this score">
        {data.parts.map((p, i) => (
          <li key={p.key} className="t-small flex items-center gap-1.5 text-soft">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: METER_COLORS[i] }} />
            {p.label} {Math.round(p.score * 100)}%
          </li>
        ))}
      </ul>

      {onChoose ? (
        <Button className="mt-5" fullWidth onClick={onChoose}>
          Join this tribe
        </Button>
      ) : null}
    </article>
  );
}
