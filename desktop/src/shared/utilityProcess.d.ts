export type UtilityProcessMessage =
  | { type: "dispose" }
  | { type: "get-memory-usage" }
  | { type: "health-check" };

export type UtilityProcessResponse =
  // | { type: "status"; status: string; message?: string }
  | { type: "error"; error: string }
  | { type: "memory"; usage: MemoryUsage }
  | { type: "result"; result: any };

// https://nodejs.org/api/process.html#processmemoryusage
export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}
