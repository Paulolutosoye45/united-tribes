"use client";

import { Button } from "@/components/ui/Button";

/** Opens the browser's print dialog; "Save as PDF" is one of its choices on every phone and computer. */
export function PrintButton() {
  return (
    <Button variant="quiet" size="md" onClick={() => window.print()} className="no-print">
      Print or save as PDF
    </Button>
  );
}
