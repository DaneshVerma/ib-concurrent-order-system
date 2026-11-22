import {
  parentPort,
  threadId,
  workerData
} from "node:worker_threads";

import { Order } from "../models/order.model";
import {
  MainToWorkerMessage,
  WorkerToMainMessage
} from "./worker.types";

if (!parentPort) {
  throw new Error("Worker must run inside a worker thread");
}

const workerPort = parentPort;

const { inventoryBuffer } = workerData as {
  inventoryBuffer: SharedArrayBuffer;
};

const inventory = new Int32Array(inventoryBuffer);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomProcessingTime(): number {
  return Math.floor(Math.random() * 3000) + 2000;
}

// Acquire the product's lock.
function acquireLock(lockIndex: number): void {
  while (
    Atomics.compareExchange(inventory, lockIndex, 0, 1) !== 0
  ) {
    Atomics.wait(inventory, lockIndex, 1);
  }
}

// Release the product's lock.
function releaseLock(lockIndex: number): void {
  Atomics.store(inventory, lockIndex, 0);
  Atomics.notify(inventory, lockIndex, 1);
}

// Reserve stock before processing.
function reserveStock(
  inventoryIndex: number,
  quantity: number
): boolean {
  const stockIndex = inventoryIndex;
  const reservedIndex = inventoryIndex + 1;
  const lockIndex = inventoryIndex + 2;

  acquireLock(lockIndex);

  try {
    const stock = Atomics.load(inventory, stockIndex);
    const reserved = Atomics.load(inventory, reservedIndex);

    const available = stock - reserved;

    if (available < quantity) {
      return false;
    }

    Atomics.add(inventory, reservedIndex, quantity);

    return true;
  } finally {
    releaseLock(lockIndex);
  }
}

// Commit the reservation after successful processing.
function commitStock(
  inventoryIndex: number,
  quantity: number
): void {
  const lockIndex = inventoryIndex + 2;

  acquireLock(lockIndex);

  try {
    Atomics.sub(inventory, inventoryIndex, quantity);
    Atomics.sub(inventory, inventoryIndex + 1, quantity);
  } finally {
    releaseLock(lockIndex);
  }
}

// Release reserved stock if processing fails.
function rollbackStock(
  inventoryIndex: number,
  quantity: number
): void {
  const lockIndex = inventoryIndex + 2;

  acquireLock(lockIndex);

  try {
    Atomics.sub(inventory, inventoryIndex + 1, quantity);
  } finally {
    releaseLock(lockIndex);
  }
}

async function processOrder(
  order: Order,
  inventoryIndex: number
): Promise<void> {
  const startedAt = Date.now();

  let reserved = false;
  let committed = false;

  try {
    console.log(
      `[WORKER ${threadId}] Checking inventory for ${order.id}`
    );

    reserved = reserveStock(inventoryIndex, order.quantity);

    if (!reserved) {
      throw new Error("Insufficient inventory");
    }

    console.log(
      `[WORKER ${threadId}] Reserved ${order.quantity} units for ${order.id}`
    );

    const processingTime = randomProcessingTime();

    console.log(
      `[WORKER ${threadId}] Processing order ${order.id}`
    );

    await delay(processingTime);

    commitStock(inventoryIndex, order.quantity);
    committed = true;

    const result: WorkerToMainMessage = {
      type: "ORDER_COMPLETED",
      orderId: order.id,
      processingTime: Date.now() - startedAt
    };

    workerPort.postMessage(result);

    console.log(
      `[WORKER ${threadId}] Completed order ${order.id}`
    );
  } catch (error) {
    if (reserved && !committed) {
      rollbackStock(inventoryIndex, order.quantity);
    }

    const result: WorkerToMainMessage = {
      type: "ORDER_FAILED",
      orderId: order.id,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      processingTime: Date.now() - startedAt
    };

    workerPort.postMessage(result);

    console.log(
      `[WORKER ${threadId}] Failed order ${order.id}`
    );
  } finally {
    const readyMessage: WorkerToMainMessage = {
      type: "READY"
    };

    workerPort.postMessage(readyMessage);
  }
}

console.log(`[WORKER ${threadId}] Started`);

workerPort.on("message", (message: MainToWorkerMessage) => {
  if (message.type === "STOP") {
    console.log(`[WORKER ${threadId}] Shutting down`);
    workerPort.close();
    return;
  }

  void processOrder(message.order, message.inventoryIndex);
});

// Tell main thread this worker is ready.
const readyMessage: WorkerToMainMessage = {
  type: "READY"
};

workerPort.postMessage(readyMessage);
