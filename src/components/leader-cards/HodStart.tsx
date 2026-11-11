"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { makeHodReportAction, readHodAction } from "@/app/(app)/admin/people/leader-cards/reconcile/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { HOD_HEADER, HOD_MAX_ROWS, HOD_TEMPLATE, type HodProblem, type HodRow } from "@/lib/leader-cards/hod";
import { pluralise } from "@/lib/placement/wording";

/**
 * Start a report: upload or paste the list of heads of department, read what was understood, and make the report. Making the report sends nothing and changes
 * nobody; the report says where each person stands, and each thing that can be done from it is its own button on the report.
 */
export function HodStart() {
  const router = useRouter();
  const d = useDo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<HodRow[] | null>(null);
  const [problems, setProblems] = useState<HodProblem[]>([]);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function read() {
    setReading(true);
    setProblem(null);
    const form = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) form.set("file", file);
    else form.set("text", text);
    let r;
    try {
      r = await readHodAction(form);
    } catch {
      setReading(false);
      return setProblem("We couldn’t read that. Check your connection and try again.");
    }
    setReading(false);
    if (!r.ok) {
      setRows(null);
      setProblems([]);
      return setProblem(r.message);
    }
    setRows(r.rows);
    setProblems(r.problems);
  }

  async function make() {
    let id: string | null = null;
    const ok = await d.go("make", async () => {
      const r = await makeHodReportAction(rows ?? [], note);
      if (r.ok) id = r.id;
      return r.ok ? { ok: true as const } : r;
    });
    if (ok && id) router.push(`/admin/people/leader-cards/reconcile?run=${id}`);
  }

  return (
    <section aria-labelledby="hod-start" className="card flex flex-col gap-5 p-5 sm:p-6" data-testid="hod-start">
      <div>
        <h2 id="hod-start" className="t-heading">
          Check a list
        </h2>
        <p className="t-small text-soft">
          Making a report sends nothing and changes nobody. It only says where each person on your list stands. You choose what to do after you have read it.
        </p>
      </div>
      <p className="t-small text-soft">
        One row each, up to {HOD_MAX_ROWS}: {HOD_HEADER.join(", ")}. Each person needs an email or a phone number, or both. Goal can be left empty.{" "}
        <a className="underline underline-offset-4" download="heads-of-department-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(HOD_TEMPLATE)}`}>
          Download a template
        </a>
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.95rem] font-medium">An Excel or CSV file</span>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="t-small" onChange={() => setRows(null)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[0.95rem] font-medium">Or paste the rows, titles first</span>
        <textarea className="input min-h-28 py-3 font-mono text-sm" value={text} onChange={(e) => (setText(e.target.value), setRows(null))} spellCheck={false} />
      </label>
      <div>
        <Button size="md" variant="quiet" loading={reading} onClick={() => void read()}>
          Read the list
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="t-small text-danger">
          {problem}
        </p>
      ) : null}
      {rows ? (
        <div className="flex flex-col gap-4" role="status" data-testid="hod-read">
          <p className="font-semibold">{pluralise(rows.length, "row")} read from the list.</p>
          {problems.length > 0 ? (
            <ul className="t-small flex flex-col gap-1 text-soft">
              {problems.map((p) => (
                <li key={`${p.line}-${p.text}`}>
                  Line {p.line}: {p.text}
                </li>
              ))}
            </ul>
          ) : null}
          <label className="flex max-w-md flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">A note to remember it by (optional)</span>
            <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="For example: the list from the October meeting" />
          </label>
          <Notice error={d.error} />
          <div>
            <Button size="md" variant="solid" loading={d.busy === "make"} disabled={rows.length === 0} onClick={() => void make()}>
              Make the report
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
