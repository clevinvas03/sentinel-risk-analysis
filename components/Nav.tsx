"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Terminal" },
  { href: "/explorer", label: "Knowledge Base" },
  { href: "/history", label: "History" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-ink-700/70 bg-ink-900/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3.5">
        <Link href="/" className="group flex items-center gap-2.5">
          <Logo />
          <span className="flex flex-col leading-none">
            <span className="font-display text-[1.15rem] font-semibold tracking-tight text-fg">
              Sentinel
            </span>
            <span className="label mt-1 text-[0.56rem]">risk intelligence</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-ink-750 text-fg"
                    : "text-fg-faint hover:text-fg-dim"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-kb pulse-dot" />
          <span className="label">live</span>
        </div>
      </div>
    </header>
  );
}

// Logo: a clay "squircle" tile holding a shield (risk) whose interior is a
// site-scan target (geospatial). Drawn as a crisp app-mark, not an emoji.
function Logo() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden
      className="shrink-0 drop-shadow-[0_2px_4px_rgba(90,50,30,0.18)]"
    >
      <defs>
        <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C0623A" />
          <stop offset="1" stopColor="#9C4828" />
        </linearGradient>
      </defs>
      {/* tile */}
      <rect x="1" y="1" width="32" height="32" rx="9.5" fill="url(#tile)" />
      <rect
        x="1.5"
        y="1.5"
        width="31"
        height="31"
        rx="9"
        stroke="#ffffff"
        strokeOpacity="0.18"
      />
      {/* shield silhouette */}
      <path
        d="M17 7.2c2.1 1.4 4.3 2.1 6.6 2.2.0 0 .0 6.2-.0 7.7 0 4.4-3.0 7.4-6.6 9-3.6-1.6-6.6-4.6-6.6-9 0-1.5 0-7.7 0-7.7 2.3-.1 4.5-.8 6.6-2.2Z"
        fill="#F4EFE3"
        fillOpacity="0.16"
        stroke="#F6F1E6"
        strokeOpacity="0.9"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* site-scan target inside the shield */}
      <circle cx="17" cy="16.4" r="3.4" stroke="#F6F1E6" strokeWidth="1.2" />
      <circle cx="17" cy="16.4" r="1.25" fill="#F6F1E6" />
    </svg>
  );
}
