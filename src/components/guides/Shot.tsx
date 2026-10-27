import type { PictureView } from "@/lib/guides/view";
import { IconExpand } from "./icons";

/**
 * A picture with the ring drawn over it. The ring and its label are not part of the picture: they are drawn here, from where the picture
 * maker found the thing, so they stay sharp at any size and the picture itself stays a plain, honest screenshot.
 */
export function Picture({ picture, priority = false, dim = true, tag = true, sizes }: { picture: PictureView; priority?: boolean; dim?: boolean; tag?: boolean; sizes?: string }) {
  const main = picture.rings.find((r) => r.tone === "main");
  const single = picture.rings.length === 1;
  // The label sits on the top edge of the ring, at its right; a ring at the very top of the picture puts it underneath instead
  const below = main ? main.y < 9 : false;
  return (
    <div className="gd-view" data-dim={dim && single ? "true" : "false"}>
      {/* A plain image: the address already carries a code that changes with the picture, and the file is already small */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={picture.url} width={picture.width} height={picture.height} alt={picture.alt} loading={priority ? "eager" : "lazy"} decoding="async" sizes={sizes} />
      {picture.rings.map((r, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`gd-ring ${r.tone === "main" ? "is-main" : "is-second"}`}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
        />
      ))}
      {tag && main && picture.tag ? (
        <span
          aria-hidden="true"
          className="gd-tag"
          style={{
            right: `${Math.max(2, 100 - (main.x + main.w) + 2)}%`,
            top: below ? `${main.y + main.h}%` : `${main.y}%`,
            transform: below ? "translateY(8px)" : "translateY(-55%)",
          }}
        >
          {picture.tag.text}
        </span>
      ) : null}
    </div>
  );
}

/** The picture of a step in its frame, with a caption that says what the ring means and (in the reader) a button to enlarge it. */
export function Shot({ picture, first = false, onZoom, priority = false }: { picture: PictureView; first?: boolean; onZoom?: () => void; priority?: boolean }) {
  return (
    <figure className="gd-shot">
      <div className="gd-frame">
        <Picture picture={picture} priority={priority} />
        {onZoom ? (
          <button type="button" className="gd-zoom press" onClick={onZoom} aria-label="Enlarge the picture">
            <IconExpand />
          </button>
        ) : null}
      </div>
      {first ? (
        <figcaption className="gd-cap">
          <i aria-hidden="true" />
          The orange ring shows you where to look.
        </figcaption>
      ) : null}
    </figure>
  );
}
