"use client";

import { useState } from "react";
import { createCentreAction, saveSettingsAction } from "@/app/(app)/admin/settings/actions";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import type { ChurchSettings } from "@/lib/admin/types";
import { Notice } from "./Notice";
import { useDo } from "./useDo";

/** The church's own words and the address of the testimony form. They belong to the pastorate. */
export function SettingsForm({ settings }: { settings: ChurchSettings }) {
  const d = useDo();
  const [vision, setVision] = useState(settings.vision ?? "");
  const [mission, setMission] = useState(settings.mission ?? "");
  const [url, setUrl] = useState(settings.testimony_form_url ?? "");
  const same = vision.trim() === (settings.vision ?? "") && mission.trim() === (settings.mission ?? "") && url.trim() === (settings.testimony_form_url ?? "");

  return (
    <form
      noValidate
      aria-label="The church’s words"
      className="card flex flex-col gap-5 p-5 sm:p-7"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("save", () => saveSettingsAction(vision, mission, url), { saved: "Saved." });
      }}
    >
      <Textarea label="Vision" value={vision} onChange={(e) => setVision(e.target.value)} maxLength={600} disabled={!settings.can_edit} optional hint="Leaders read it in the Academy, in the church’s own words." />
      <Textarea label="Mission" value={mission} onChange={(e) => setMission(e.target.value)} maxLength={600} disabled={!settings.can_edit} optional />
      <Input
        label="Address of the testimony form"
        type="url"
        inputMode="url"
        autoComplete="off"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        maxLength={300}
        disabled={!settings.can_edit}
        optional
        hint="Where the pastorate forwards testimonies. It must start with https://"
        placeholder="https://"
      />
      <Notice error={d.error} saved={d.saved} />
      {settings.can_edit ? (
        <div>
          <Button type="submit" size="md" loading={d.busy === "save"} disabled={same}>
            Save
          </Button>
        </div>
      ) : (
        <p className="t-small text-soft">Only the pastor, directors and the admin change these.</p>
      )}
    </form>
  );
}

/** Opens a second centre. Offered only when the platform switch for more than one centre is on. */
export function CentreForm() {
  const d = useDo();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  return (
    <form
      noValidate
      aria-label="Open a centre"
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("create", () => createCentreAction(slug, name), { saved: "Centre opened.", after: () => {
            setName("");
            setSlug("");
          } });
      }}
    >
      <h3 className="font-semibold">Open another centre</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <Input label="Short name for the address" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40} hint="Lower-case letters, numbers and hyphens." />
      </div>
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="sm" loading={d.busy === "create"} disabled={name.trim().length < 3 || slug.length < 2}>
          Open the centre
        </Button>
      </div>
    </form>
  );
}
