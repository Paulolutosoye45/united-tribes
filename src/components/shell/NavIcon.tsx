import type { NavItem } from "@/lib/auth/roles";

export function NavIcon({ name, size = 22 }: { name: NavItem["icon"]; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "admin") {
    return (
      <svg {...common}>
        <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.1 7.5 9.5 4.4-1.4 7.5-5.1 7.5-9.5V6L12 3Z" />
        <path d="m9 12 2.2 2.2L15.5 10" />
      </svg>
    );
  }
  if (name === "chart") {
    return (
      <svg {...common}>
        <path d="M4.5 20h15" />
        <path d="M7 20v-6.5M12 20V6M17 20v-9.5" />
      </svg>
    );
  }
  if (name === "lead") {
    return (
      <svg {...common}>
        <circle cx="12" cy="7.5" r="3" />
        <path d="M6.5 20c.3-3.4 2.4-5.4 5.5-5.4s5.2 2 5.5 5.4" />
        <path d="M19 3.5v3M17.5 5h3" />
      </svg>
    );
  }
  if (name === "review") {
    return (
      <svg {...common}>
        <path d="M7 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20V3.5Z" />
        <path d="M14.5 3.5V8H19" />
        <path d="m9.5 14 1.8 1.8 3.4-3.6" />
      </svg>
    );
  }
  if (name === "join") {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="3.2" />
        <path d="M3.5 19.5c.4-3 2.5-4.8 5.5-4.8s5.1 1.8 5.5 4.8" />
        <circle cx="17" cy="8" r="2.4" />
        <path d="M16.5 14.2c2.4-.1 4 1.3 4.5 3.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5h12V10" />
      <path d="M10 19.5V14h4v5.5" />
    </svg>
  );
}
