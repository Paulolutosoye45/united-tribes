export function ProgressRing({
  value,
  size = 56,
  label,
}: {
  /** 0 to 1 */
  value: number;
  size?: number;
  label: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label={`${label}: ${Math.round(v * 100)}%`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="var(--crest-flame)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`}
        transform="rotate(-90 28 28)"
      />
      <text x="28" y="33" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--ink)">
        {Math.round(v * 100)}
      </text>
    </svg>
  );
}
