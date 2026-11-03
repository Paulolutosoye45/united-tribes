"use client";

import { useState } from "react";
import { PlaceOne } from "@/components/placement/PlaceOne";
import type { OneOption, PlacementMode, PlacerRole } from "@/lib/placement/types";

/**
 * The section of a person's page that places them or moves them. Whether it is a placement or a move is fixed when the page opens, so the receipt
 * does not turn into "Move to another tribe" the moment the seat exists.
 */
export function PersonPlace({ person, name, options, mode, role, hasSeat, ownerLink = false }: { person: string; name: string; options: OneOption[]; mode: PlacementMode | null; role: PlacerRole; hasSeat: boolean; ownerLink?: boolean }) {
  const [move] = useState(hasSeat);
  return (
    <section aria-label={move ? "Move to another tribe" : "Place in a tribe"} className="flex flex-col gap-3">
      <h2 className="t-heading">{move ? "Move to another tribe" : "Place in a tribe"}</h2>
      <div className="card flex flex-col gap-2 p-5">
        <PlaceOne person={person} name={name} options={options} mode={mode} role={role} move={move} ownerLink={ownerLink} />
      </div>
    </section>
  );
}
