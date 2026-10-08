"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { deleteAnswersAction } from "@/app/(app)/profile/actions";

export function DeleteAnswers() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="quiet" size="md" onClick={() => setConfirming(true)}>
        Delete my answers
      </Button>
    );
  }
  return (
    <form action={deleteAnswersAction} className="pop-in card flex flex-col gap-4 border-danger/40 p-5">
      <p className="font-semibold">Delete all your answers and stop using them to match you?</p>
      <p className="t-small text-soft">
        This removes your answers and any saved draft. You can fill in the form again whenever you like.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="solid" size="md">
          Yes, delete them
        </Button>
        <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
          Keep them
        </Button>
      </div>
    </form>
  );
}
