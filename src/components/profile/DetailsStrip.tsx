import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";

/** On a leader's page: how many details wait for their confirmation, and one button to My page. Nothing at all when there are none, or when My page is closed to them. */
export function DetailsStrip({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <section aria-labelledby="details-strip-h" className="card flex flex-wrap items-center justify-between gap-4 p-5" data-testid="details-strip">
      <div className="flex max-w-[34rem] flex-col gap-1">
        <h2 id="details-strip-h" className="t-heading">
          Please check your details
        </h2>
        <p className="t-body text-soft">The church holds {count === 1 ? "one detail" : `${count} details`} about your tribe that only you can confirm. It takes under a minute.</p>
      </div>
      <Link href="/my" className={buttonClasses({ className: "px-8" })}>
        <span className="relative">Confirm your details</span>
      </Link>
    </section>
  );
}
