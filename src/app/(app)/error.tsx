"use client";

import { Button } from "@/components/ui/Button";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex max-w-md flex-col items-start gap-4">
      <h1 className="t-title">That didn&apos;t load</h1>
      <p className="t-body text-soft">
        Something went wrong on our side. Try again, and if it keeps happening, tell the programme office.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
