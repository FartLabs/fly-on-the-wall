export type UtilityProcessMessage =
  | { type: "dispose"; requestId?: string }
  | { type: "get-memory-usage"; requestId?: string }
  | { type: "health-check"; requestId?: string };

export type UtilityProcessResponse =
  // | { type: "status"; status: string; message?: string }
  | { type: "error"; error: string; requestId?: string }
  | { type: "memory"; usage: MemoryUsage }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: "result"; result: any; requestId?: string };

// https://nodejs.org/api/process.html#processmemoryusage
export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}
