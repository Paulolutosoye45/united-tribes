"use client";

import { useActionState } from "react";
import { setRecordingAction, setRetentionAction, setThresholdAction, type SettingState } from "@/app/(app)/god/activity/actions";
import { Notice } from "@/components/admin/Notice";
import { Button } from "@/components/ui/Button";
import type { Threshold } from "@/lib/activity/types";

const IDLE: SettingState = { status: "idle", message: "" };
const notice = (s: SettingState) => <Notice error={s.status === "error" ? s.message : null} saved={s.status === "ok" ? s.message : null} />;

/** One flag: the number at which a decision is raised. */
export function ThresholdForm({ item }: { item: Threshold }) {
  const [state, action, pending] = useActionState(setThresholdAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-2 py-3" data-threshold={item.key}>
      <input type="hidden" name="key" value={item.key} />
      <label htmlFor={`t-${item.key}`} className="t-body">
        {item.template.replace("{value}", "…")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={`t-${item.key}`}
          name="value"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          step={1}
          required
          defaultValue={item.value}
          className="h-11 w-28 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink focus:border-ink focus:outline-none"
        />
        <span className="t-small text-soft">{item.unit === "count" ? "messages" : item.unit}</span>
        <Button type="submit" variant="quiet" size="sm" loading={pending}>
          Save
        </Button>
      </div>
      {notice(state)}
    </form>
  );
}

export function RecordingForm({ recording }: { recording: boolean }) {
  const [state, action, pending] = useActionState(setRecordingAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="recording" value={recording ? "off" : "on"} />
      <p className="t-body">
        Recording is <strong>{recording ? "on" : "off"}</strong>.{" "}
        {recording ? "Pausing it stops anything new being counted. Nothing already counted is lost." : "Nothing new is being counted until you switch it on."}
      </p>
      <div>
        <Button type="submit" variant={recording ? "quiet" : "solid"} size="md" loading={pending}>
          {recording ? "Pause recording" : "Resume recording"}
        </Button>
      </div>
      {notice(state)}
    </form>
  );
}

export function RetentionForm({ months }: { months: number }) {
  const [state, action, pending] = useActionState(setRetentionAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="months" className="t-body">
        Keep detailed events for
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="months"
          name="months"
          type="number"
          inputMode="numeric"
          min={3}
          max={36}
          step={1}
          required
          defaultValue={months}
          className="h-11 w-28 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink focus:border-ink focus:outline-none"
        />
        <span className="t-small text-soft">months (3 to 36)</span>
        <Button type="submit" variant="quiet" size="sm" loading={pending}>
          Save
        </Button>
      </div>
      <p className="t-small text-soft">Older detail is deleted by the daily clean-up. The daily counts behind the charts stay.</p>
      {notice(state)}
    </form>
  );
}
