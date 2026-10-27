import type { ReactNode } from "react";

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconBulb = () => (
  <svg {...base}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
  </svg>
);
export const IconWarn = () => (
  <svg {...base}>
    <path d="M12 3 2.5 20h19L12 3ZM12 10v4.5M12 17.5v.01" />
  </svg>
);
export const IconWhy = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6M12 17v.01" />
  </svg>
);
export const IconQuote = () => (
  <svg {...base}>
    <path d="M7 8c-2 .5-3 2-3 4v3h4v-4H6.2c.1-.9.6-1.4 1.3-1.7M16 8c-2 .5-3 2-3 4v3h4v-4h-1.8c.1-.9.6-1.4 1.3-1.7" />
  </svg>
);
export const IconExpand = () => (
  <svg {...base} width={18} height={18}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </svg>
);
export const IconBack = () => (
  <svg {...base} width={18} height={18}>
    <path d="m15 5-7 7 7 7" />
  </svg>
);
export const IconNext = () => (
  <svg {...base} width={18} height={18}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);
export const IconList = () => (
  <svg {...base} width={18} height={18}>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </svg>
);
export const IconClose = () => (
  <svg {...base} width={18} height={18}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconCheck = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} strokeWidth={3.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const IconShare = () => (
  <svg {...base} width={18} height={18}>
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </svg>
);
export const IconPrint = () => (
  <svg {...base} width={18} height={18}>
    <path d="M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" />
  </svg>
);
export const IconClock = () => (
  <svg {...base} width={16} height={16}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconSteps = () => (
  <svg {...base} width={16} height={16}>
    <path d="M4 7h2M4 12h2M4 17h2M10 7h10M10 12h10M10 17h10" />
  </svg>
);
export const IconSearch = () => (
  <svg {...base} width={18} height={18}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const IconHelp = () => (
  <svg {...base} width={18} height={18}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6M12 17v.01" />
  </svg>
);
export const IconLock = () => (
  <svg {...base} width={18} height={18}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export type { ReactNode };
