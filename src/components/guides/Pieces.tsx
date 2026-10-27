import type { Piece } from "@/lib/guides/markup";

/** A line of a guide, with its marks drawn: bold for what to notice, a pale label for a button or field named exactly as the screen spells it. */
export function Pieces({ line }: { line: Piece[] }) {
  return (
    <>
      {line.map((p, i) =>
        p.kind === "bold" ? (
          <strong key={i} className="gd-bold">
            {p.text}
          </strong>
        ) : p.kind === "label" ? (
          <span key={i} className="gd-label">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
