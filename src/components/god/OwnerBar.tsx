import { lockAction } from "@/app/(app)/god/actions";
import { Button } from "@/components/ui/Button";
import { formatLagosTime } from "@/lib/dates";
import { GodNav } from "./GodNav";

/** Sits above every console page: where you are, how long the access lasts, and the way to end it now. */
export function OwnerBar({ until }: { until: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] bg-charcoal px-4 py-3 text-white">
        <p className="t-small">
          <span className="font-semibold">Owner access is on.</span>{" "}
          <span className="opacity-80">{until ? `It ends at ${formatLagosTime(until)}. ` : ""}Everything you change is written down privately for you.</span>
        </p>
        <form action={lockAction}>
          <Button type="submit" variant="night" size="sm">
            Lock now
          </Button>
        </form>
      </div>
      <GodNav />
    </div>
  );
}
