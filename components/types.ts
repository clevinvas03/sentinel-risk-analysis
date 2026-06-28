// Client-side shared types (mirrors the agent's event/source shapes).

export type Source = {
  kind: "kb" | "web" | "parcel";
  title: string;
  url: string | null;
  chunkId?: number;
  source?: string;
  similarity?: number;
  apn?: string;
  county?: string;
  live?: boolean;
};

export type TraceEntry = { step: string; detail?: string; at?: number };

export type AgentEvent =
  | { type: "trace"; step: string; detail?: string }
  | { type: "thinking"; text: string }
  | { type: "token"; text: string }
  | { type: "answer_reset" }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; answer: string; sources: Source[]; trace: TraceEntry[] }
  | { type: "error"; message: string };
