/** Why something failed, or that it worked. Failures are announced; successes are polite. */
export function Notice({ error, saved }: { error: string | null; saved?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
        {error}
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3 text-ink">
        {saved}
      </p>
    );
  }
  return null;
}
