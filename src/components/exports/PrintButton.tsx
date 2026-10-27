"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";

/** Opens the browser's print window, where "Save as PDF" is one of the choices. Shown on the screen and hidden on paper. */
export function PrintButton() {
  return (
    <div className="no-print flex flex-wrap items-center gap-3">
      <Button size="md" variant="solid" onClick={() => window.print()} data-testid="print-now">
        Print or save as PDF
      </Button>
      <Link href="/exports/mine" className="press inline-flex min-h-12 items-center px-2 text-[0.95rem] font-medium text-soft hover:text-ink">
        Back to my files
      </Link>
    </div>
  );
}
