"use client";

import { useState } from "react";

// Inspiration only — clicking fills the input, but the user can type ANYTHING.
// Dismissible, to reinforce that these do not constrain the input.
const EXAMPLES = [
  "Seismic risk near Naples?",
  "Ireland or Denmark for a hyperscale build?",
  "Biggest emerging risk for European data centres?",
  "Flood & grid risk for a site near Frankfurt?",
  "Parcels near downtown San Jose, and what's adjacent?",
];

export function ExamplePills({ onPick }: { onPick: (q: string) => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2">
      <span className="label mr-0.5">try</span>
      {EXAMPLES.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => onPick(ex)}
          className="rounded-full border border-ink-700 px-3 py-1 text-xs text-fg-dim transition-colors hover:border-signal/50 hover:text-fg"
        >
          {ex}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-1 text-xs text-fg-faint transition-colors hover:text-fg-dim"
        aria-label="Dismiss examples"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
