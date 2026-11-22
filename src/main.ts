
import { Worker } from "node:worker_threads";
import path from "node:path";

import { Order } from "./models/order.model";
import { OrderQueue } from "./queue/order.queue";
import {
  MainToWorkerMessage,
  WorkerToMainMessage
} from "./workers/worker.types";
import { InventoryManager } from "./inventory/inventory.manager";
import { generateOrders } from "./services/order-generator";

const WORKER_COUNT = 6;

const queue = new OrderQueue();

const CUSTOMER_COUNT = 100;

const orders = generateOrders(CUSTOMER_COUNT);

console.log(
  `[MAIN] Generated ${orders.length} orders from ${CUSTOMER_COUNT} customers`
);

const completedProcessingTimes: number[] = [];

const failedProcessingTimes: number[] = [];

const inventoryManager = new InventoryManager([
  {
    id: "PROD-001",
    name: "Laptop",
    price: 50000,
    stock: 50
  },
  {
    id: "PROD-002",
    name: "Mouse",
    price: 1000,
    stock: 100
  },
  {
    id: "PROD-003",
    name: "Keyboard",
    price: 2000,
    stock: 75
  }
]);

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
    order,
    inventoryIndex: inventoryManager.getProductIndex(order.productId)
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

      completedProcessingTimes.push(message.processingTime);

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

      failedProcessingTimes.push(message.processingTime);

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
      const worker = new Worker(workerFile, {
        workerData: {
          inventoryBuffer: inventoryManager.getSharedBuffer()
        }
      });
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

  const completed = orders.filter(
    (order) => order.status === "COMPLETED"
  ).length;

  const failed = orders.filter(
    (order) => order.status === "FAILED"
  ).length;

  const pending = orders.filter(
    (order) => order.status === "PENDING"
  ).length;

  const totalProcessed = completed + failed;

  const totalSuccessfulProcessingTime =
    completedProcessingTimes.reduce((sum, time) => sum + time, 0);

  const averageSuccessfulProcessingTime =
    completed > 0
      ? totalSuccessfulProcessingTime / completed
      : 0;

  const averageFailedAttemptTime =
    failed > 0
      ? failedProcessingTimes.reduce((sum, time) => sum + time, 0) / failed
      : 0;

  const totalExecutionTime = Date.now() - startedAt;

  console.log("\n========== FINAL REPORT ==========");
  console.log(`Total orders: ${orders.length}`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pending: ${pending}`);

  console.log(
    `Average successful processing time: ${averageSuccessfulProcessingTime.toFixed(2)}ms`
  );

  console.log(
    `Average failed attempt time: ${averageFailedAttemptTime.toFixed(2)}ms`
  );


  console.log(`Total execution time: ${totalExecutionTime}ms`);

  console.log("\nFinal Inventory:");
  console.table(inventoryManager.getSnapshot());
}

main().catch((error) => {
  console.error("Application failed:", error);
  process.exitCode = 1;
});
