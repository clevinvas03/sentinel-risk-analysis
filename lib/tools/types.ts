// Shared types for the tool layer and the agent loop.

export type Source = {
  kind: "kb" | "web" | "parcel";
  title: string;
  url: string | null;
  // KB-only metadata
  chunkId?: number;
  source?: string; // gdacs | reliefweb | datacenterdynamics | planning | seed
  similarity?: number;
  // parcel-only metadata
  apn?: string;
  county?: string;
  live?: boolean; // false => offline sample fixture
};

// Context handed to every tool so it can narrate the live trace and register the
// sources it actually consulted. The agent loop wires these to the SSE stream.
export type ToolContext = {
  emitTrace: (step: string, detail?: string) => void;
  addSource: (source: Source) => void;
};

// A tool returns the string that goes back to the model as the tool_result.
export type ToolHandler = (
  input: any,
  ctx: ToolContext
) => Promise<string>;
