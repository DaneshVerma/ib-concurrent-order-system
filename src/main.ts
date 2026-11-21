
import { Worker } from "node:worker_threads";
import path from "node:path";

import { Order } from "./models/order.model";
import { OrderQueue } from "./queue/order.queue";
import {
  MainToWorkerMessage,
  WorkerToMainMessage
} from "./workers/worker.types";

const WORKER_COUNT = 6;

const queue = new OrderQueue();

const orders: Order[] = Array.from(
  { length: 15 },
  (_, index) => ({
    id: `ORD-${String(index + 1).padStart(3, "0")}`,
    customerId: `CUS-${String(index + 1).padStart(3, "0")}`,
    productId: "PROD-001",
    quantity: 1,
    createdAt: new Date(),
    status: "PENDING"
  })
);

// Add all orders before starting workers.
orders.forEach((order) => queue.enqueue(order));

const orderMap = new Map(
  orders.map((order) => [order.id, order])
);

const workerFile = path.join(
  __dirname,
  "workers",
  "order.worker.js"
);

const workers: Worker[] = [];

const startedAt = Date.now();

function dispatchOrder(worker: Worker): void {
  const order = queue.dequeue();

  if (!order) {
    const message: MainToWorkerMessage = {
      type: "STOP"
    };

    worker.postMessage(message);
    return;
  }

  order.status = "PROCESSING";

  const message: MainToWorkerMessage = {
    type: "PROCESS",
    order
  };

  worker.postMessage(message);
}

function handleWorkerMessage(
  worker: Worker,
  message: WorkerToMainMessage
): void {
  switch (message.type) {
    case "READY": {
      dispatchOrder(worker);
      break;
    }

    case "ORDER_COMPLETED": {
      const order = orderMap.get(message.orderId);

      if (order) {
        order.status = "COMPLETED";
      }

      console.log(
        `[MAIN] Order ${message.orderId} completed in ${message.processingTime}ms`
      );

      break;
    }

    case "ORDER_FAILED": {
      const order = orderMap.get(message.orderId);

      if (order) {
        order.status = "FAILED";
      }

      console.error(
        `[MAIN] Order ${message.orderId} failed: ${message.error}`
      );

      break;
    }
  }
}

function startWorkers(): Promise<void> {
  return new Promise((resolve, reject) => {
    let exitedWorkers = 0;
    let hasFailed = false;

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(workerFile);

      workers.push(worker);

      worker.on("message", (message: WorkerToMainMessage) => {
        handleWorkerMessage(worker, message);
      });

      worker.on("error", (error) => {
        if (!hasFailed) {
          hasFailed = true;
          reject(error);
        }
      });

      worker.on("exit", (code) => {
        exitedWorkers++;

        if (code !== 0 && !hasFailed) {
          hasFailed = true;
          reject(new Error(`Worker exited with code ${code}`));
          return;
        }

        console.log(
          `[MAIN] Worker exited. (${exitedWorkers}/${WORKER_COUNT})`
        );

        if (exitedWorkers === WORKER_COUNT && !hasFailed) {
          resolve();
        }
      });
    }
  });
}

async function main(): Promise<void> {
  console.log("\nStarting order processing...\n");

  await startWorkers();

  const totalTime = Date.now() - startedAt;

  const completed = orders.filter(
    (order) => order.status === "COMPLETED"
  ).length;

  const failed = orders.filter(
    (order) => order.status === "FAILED"
  ).length;

  const pending = orders.filter(
    (order) => order.status === "PENDING"
  ).length;

  console.log("\n========== FINAL REPORT ==========");
  console.log(`Total orders: ${orders.length}`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pending: ${pending}`);
  console.log(`Total processing time: ${totalTime}ms`);
  console.log("==================================");
}

main().catch((error) => {
  console.error("Application failed:", error);
  process.exitCode = 1;
});
