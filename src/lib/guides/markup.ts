/**
 * The two marks a guide's words may use.
 *   **bold**    a thing to notice
 *   [[Label]]   a button, link, field or heading exactly as the screen spells it
 * Nothing else is read as a mark, so a guide cannot carry a link or a script by accident.
 */
export type Piece = { kind: "text" | "bold" | "label"; text: string };

export function pieces(line: string): Piece[] {
  const out: Piece[] = [];
  const re = /\*\*(.+?)\*\*|\[\[(.+?)\]\]/g;
  let at = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > at) out.push({ kind: "text", text: line.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "label", text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ kind: "text", text: line.slice(at) });
  return out;
}

/** The words with the marks taken off: what a screen reader or a search reads. */
export function plain(line: string): string {
  return pieces(line)
    .map((p) => p.text)
    .join("");
}

/** Every [[Label]] in a line, in order. */
export function labelsIn(line: string): string[] {
  return pieces(line)
    .filter((p) => p.kind === "label")
    .map((p) => p.text);
}
