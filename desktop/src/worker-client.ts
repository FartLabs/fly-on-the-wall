import type { WorkerMessage, WorkerResponse } from "./worker";

let worker: Worker | null = null;
let currentHandler: ((data: WorkerResponse) => void) | null = null;

export function getWorker(): Worker {
  if (!worker) {
    console.log("[WorkerClient] Initializing new Web Worker...");
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module"
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      // console.log("[WorkerClient] Received message from worker:", data.type); // Verbose
      if (currentHandler) {
        currentHandler(data);
      } else {
        console.warn(
          "[WorkerClient] Received message but no handler is active:",
          data
        );
      }
    };
    console.log("[WorkerClient] Web Worker initialized.");
  }
  return worker;
}

export function terminateWorker() {
  if (worker) {
    console.log("[WorkerClient] Terminating Web Worker...");
    worker.terminate();
    worker = null;
    currentHandler = null;
    console.log("[WorkerClient] Web Worker terminated.");
  }
}

export function sendWorkerMessage(
  message: WorkerMessage,
  onStatusUpdate?: (status: any) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    // Simple lock: if a handler is already active, we reject (or queue, but reject is safer for now)
    if (currentHandler) {
      console.warn(
        "[WorkerClient] Worker is busy, overriding handler (potential conflict if multiple tasks active)"
      );
    }

    console.log(`[WorkerClient] Sending message to worker: ${message.type}`);

    // Release lock via `currentHandler = null`.
    currentHandler = (data: WorkerResponse) => {
      if (data.type === "status") {
        console.log(
          `[WorkerClient] Worker status: ${data.status} - ${data.message || ""}`
        );
        onStatusUpdate?.(data);
      } else if (data.type === "result") {
        console.log(
          `[WorkerClient] Worker task completed successfully: ${message.type}`
        );
        currentHandler = null;
        resolve(data.result);
      } else if (data.type === "error") {
        console.error(`[WorkerClient] Worker error: ${data.error}`);
        currentHandler = null;
        reject(new Error(data.error));
      }
    };

    w.postMessage(message);
  });
}
