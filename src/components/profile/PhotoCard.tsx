"use client";

import { useRef, useState } from "react";
import { removePhotoAction, savePhotoAction } from "@/app/(app)/profile/actions";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { shrinkPhoto } from "@/lib/photo/resize";

/**
 * A portrait for a leader's tribe card. It is shrunk in the browser before it leaves the phone, so a
 * big camera photo costs little data. Members choosing a tribe see it on the card; nobody else does.
 */
export function PhotoCard({ personId, name, has, updatedAt }: { personId: string; name: string; has: boolean; updatedAt: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [present, setPresent] = useState(has);
  const [version, setVersion] = useState(updatedAt ?? "");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setBusy("save");
    const shrunk = await shrinkPhoto(file);
    if (!shrunk) {
      setBusy(null);
      return setMessage({ tone: "error", text: "That file could not be used as a picture. Try a photo from your phone." });
    }
    const result = await savePhotoAction(shrunk.base64, shrunk.mime);
    URL.revokeObjectURL(shrunk.previewUrl);
    setBusy(null);
    if (input.current) input.current.value = "";
    if (!result.ok) return setMessage({ tone: "error", text: result.message });
    setPresent(true);
    setVersion(result.updatedAt ?? String(Date.now()));
    setMessage({ tone: "ok", text: "Saved. Members see it on your tribe card." });
  }

  async function remove() {
    setMessage(null);
    setBusy("remove");
    const result = await removePhotoAction();
    setBusy(null);
    if (!result.ok) return setMessage({ tone: "error", text: result.message });
    setPresent(false);
    setMessage({ tone: "ok", text: "Removed." });
  }

  return (
    <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
      <Avatar name={name} photoId={present ? personId : null} version={version} size={96} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="t-small max-w-[52ch] text-soft">
          A clear, friendly face helps new members trust their first step. Members choosing a tribe see your photo on its card, and your tribe sees it too. Nobody else does.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            id="photo-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            data-testid="photo-file"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button type="button" variant="quiet" size="md" loading={busy === "save"} onClick={() => input.current?.click()}>
            {present ? "Change photo" : "Add a photo"}
          </Button>
          {present ? (
            <Button type="button" variant="ghost" size="md" loading={busy === "remove"} onClick={() => void remove()}>
              Remove
            </Button>
          ) : null}
        </div>
        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "t-small text-danger" : "t-small text-soft"}>
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
