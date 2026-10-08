"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CodeInput } from "@/components/ui/CodeInput";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export function Demos() {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<string[]>(["Step into a leadership role"]);
  const goals = ["Step into a leadership role", "Change career direction with confidence", "Build a steady client pipeline"];

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <h3 className="t-heading">Buttons</h3>
        <div className="flex flex-wrap gap-3">
          <Button>Continue</Button>
          <Button variant="solid">Save</Button>
          <Button variant="quiet">Back</Button>
          <Button variant="ghost">Skip</Button>
          <Button loading>Sending</Button>
          <Button disabled>Unavailable</Button>
        </div>
        <Button variant="quiet" onClick={() => toast.show("Invitation sent", "success")}>
          Show a message
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="t-heading">Fields</h3>
        <Input label="Email address" placeholder="you@example.com" hint="We only use it to sign you in." />
        <Input label="Email address" defaultValue="ada@" error="That email address doesn't look right." />
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="t-heading">Six-digit code</h3>
        <CodeInput value={code} onChange={setCode} />
        <p className="t-small text-soft">Type or paste. Phones offer the emailed code from the keyboard.</p>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="t-heading">Suggested choices</h3>
        <p className="t-small text-soft">The sparkle marks what the assistant proposed. Anyone can pick another or write their own.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Season goal">
          {goals.map((g, i) => (
            <Chip
              key={g}
              suggested={i < 2}
              selected={picked.includes(g)}
              onClick={() => setPicked((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))}
            >
              {g}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
