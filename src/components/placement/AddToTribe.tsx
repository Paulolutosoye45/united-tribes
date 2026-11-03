"use client";

import { useState } from "react";
import { FindMember } from "@/components/placement/FindMember";
import { PlaceOne } from "@/components/placement/PlaceOne";
import { Button } from "@/components/ui/Button";
import type { FindRow, PlacementMode, PlacerRole } from "@/lib/placement/types";

/** The tribe's own page: find a member, then place them in this tribe (or move them here from the tribe they sit in). */
export function AddToTribe({ tribe, mode, role, ownerLink = false }: { tribe: { id: string; name: string }; mode: PlacementMode | null; role: PlacerRole; ownerLink?: boolean }) {
  const [picked, setPicked] = useState<FindRow | null>(null);
  if (!picked) return <FindMember onPick={setPicked} pickLabel="Add to this tribe" />;
  return (
    <div className="flex flex-col gap-4" data-testid="add-to-tribe">
      <p className="t-body">
        <span className="font-semibold">{picked.name}</span> <span className="text-soft">· {picked.email}</span>
        {picked.tribe ? <span className="text-soft"> · now in {picked.tribe}</span> : null}
      </p>
      <PlaceOne key={picked.id} person={picked.id} name={picked.name} options={[]} mode={mode} role={role} move={picked.tribe !== null} fixedTribe={tribe} ownerLink={ownerLink} />
      <div>
        <Button size="md" variant="quiet" onClick={() => setPicked(null)} data-testid="add-to-tribe-other">
          Choose someone else
        </Button>
      </div>
    </div>
  );
}
