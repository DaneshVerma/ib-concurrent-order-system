import { parentPort, threadId } from "node:worker_threads";

import { Order } from "../models/order.model";
import { MainToWorkerMessage, WorkerToMainMessage } from "./worker.types";

if (!parentPort) {
  throw new Error("Worker must run inside a worker thread");
}
const workerPort = parentPort;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomProcessingTime(): number {
  return Math.floor(Math.random() * 3000) + 2000;
}

console.log(`[WORKER ${threadId}] Started`);

workerPort.on("message", async (message: MainToWorkerMessage) => {
  if (message.type === "STOP") {
    console.log(`[WORKER ${threadId}] Shutting down`);
    workerPort.close();
    return;
  }

  const order: Order = message.order;

  const processingTime = randomProcessingTime();
  const startedAt = Date.now();

  console.log(`[WORKER ${threadId}] Processing order ${order.id}`);

  try {
    await delay(processingTime);

    const result: WorkerToMainMessage = {
      type: "ORDER_COMPLETED",
      orderId: order.id,
      processingTime: Date.now() - startedAt,
    };

    workerPort.postMessage(result);
  } catch (error) {
    const result: WorkerToMainMessage = {
      type: "ORDER_FAILED",
      orderId: order.id,
      error: error instanceof Error ? error.message : String(error),
      processingTime: Date.now() - startedAt,
    };

    workerPort.postMessage(result);
  }

  // Tell the main thread that this worker is available again.
  const readyMessage: WorkerToMainMessage = {
    type: "READY",
  };

  workerPort.postMessage(readyMessage);
});

// Announce availability when the worker starts.
const readyMessage: WorkerToMainMessage = {
  type: "READY",
};

workerPort.postMessage(readyMessage);
