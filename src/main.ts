
import { Worker } from "node:worker_threads";
import path from "node:path";

import { OrderQueue } from "./queue/order.queue";
import {
  MainToWorkerMessage,
  WorkerState,
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


const workerStates = new Map<Worker, WorkerState>();

const startedAt = Date.now();

function dispatchOrder(worker: Worker): void {
  const state = workerStates.get(worker);

  if (!state) {
    throw new Error("Unknown worker");
  }

  let order;
  while ((order = queue.dequeue())) {
    if (inventoryManager.reserve(order.id, order.productId, order.quantity)) {
      break;
    }

    order.status = "FAILED";
    console.error(
      `[MAIN] Order ${order.id} failed: insufficient inventory`
    );
  }

  if (!order) {
    if (getBusyWorkerCount() > 0) {
      return;
    }

    state.status = "STOPPING";

    const message: MainToWorkerMessage = {
      type: "STOP"
    };

    worker.postMessage(message);
    stopIdleWorkers();
    return;
  }

  order.status = "PROCESSING";

  state.status = "BUSY";
  state.currentOrderId = order.id;

  const message: MainToWorkerMessage = {
    type: "PROCESS",
    order
  };

  try {
    worker.postMessage(message);
  } catch (error) {
    console.error(
      `[MAIN] Failed to dispatch order ${order.id}:`,
      error
    );
    // Terminate the worker.
    // Its exit handler will release the reservation
    // and requeue the order.
    void worker.terminate().catch((terminationError) => {
      console.error(
        "[MAIN] Failed to terminate worker:",
        terminationError
      );
    });
  }
}

function getOwnedOrder(worker: Worker, orderId: string) {
  const state = workerStates.get(worker);
  const order = orderMap.get(orderId);

  if (
    !state ||
    state.status !== "BUSY" ||
    state.currentOrderId !== orderId ||
    !order ||
    order.status !== "PROCESSING"
  ) {
    console.error(
      `[MAIN] Invalid result from worker for order ${orderId}`
    );
    return undefined;
  }

  return order;
}

function getBusyWorkerCount(): number {
  // Count workers whose status is BUSY
  return [...workerStates.values()].filter((v) => v.status === "BUSY").length;
}

function stopIdleWorkers(): void {
  for (const [worker, state] of workerStates) {
    if (state.status !== "IDLE") continue;

    state.status = "STOPPING";

    const message: MainToWorkerMessage = {
      type: "STOP"
    };

    worker.postMessage(message);
  }
}

function dispatchToIdleWorkers(): void {
  for (const [worker, state] of workerStates) {
    if (state.status === "IDLE" && queue.size() > 0) {
      dispatchOrder(worker);
    }
  }
}


function handleWorkerMessage(
  worker: Worker,
  message: WorkerToMainMessage
): void {
  switch (message.type) {
    case "READY": {
      const state = workerStates.get(worker);

      if (!state || state.status !== "IDLE") {
        console.error("[MAIN] Unexpected READY message from worker");
        break;
      }

      dispatchOrder(worker);
      break;
    }

    case "ORDER_COMPLETED": {
      const order = getOwnedOrder(worker, message.orderId);

      if (!order) {
        break;
      }

      inventoryManager.commit(message.orderId);
      order.status = "COMPLETED";
      const state = workerStates.get(worker);

      if (state) {
        state.status = "IDLE";
        state.currentOrderId = undefined;
      }
      completedProcessingTimes.push(message.processingTime);

      console.log(
        `[MAIN] Order ${message.orderId} completed in ${message.processingTime}ms`
      );

      break;
    }

    case "ORDER_FAILED": {
      const order = getOwnedOrder(worker, message.orderId);

      if (!order) {
        break;
      }

      inventoryManager.release(message.orderId);
      order.status = "FAILED";
      const state = workerStates.get(worker);

      if (state) {
        state.status = "IDLE";
        state.currentOrderId = undefined;
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
  return new Promise((resolve) => {
    let exitedWorkers = 0;

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(workerFile);

      workerStates.set(worker, {
        status: "IDLE"
      });

      worker.on("message", (message: WorkerToMainMessage) => {
        handleWorkerMessage(worker, message);
      });

      worker.on("error", (error) => {
        console.error("[MAIN] Worker error:", error);
      });

      worker.on("exit", (code) => {
        const state = workerStates.get(worker);

        if (state?.currentOrderId) {
          const order = orderMap.get(state.currentOrderId);

          if (order && order.status === "PROCESSING") {
            inventoryManager.release(order.id);
            order.status = "PENDING";
            queue.enqueue(order);

            console.log(`[MAIN] Requeued order ${order.id}`);
          }
        }

        // Mark the worker EXITED before redispatching.
        if (state) {
          state.currentOrderId = undefined;
          state.status = "EXITED";
        }

        exitedWorkers++;

        if (code !== 0) {
          console.error(`[MAIN] Worker crashed with exit code ${code}`);
        }

        console.log(
          `[MAIN] Worker exited. (${exitedWorkers}/${WORKER_COUNT})`
        );

        // Wake idle workers if there is work waiting.
        if (queue.size() > 0) {
          dispatchToIdleWorkers();
        } else if (getBusyWorkerCount() === 0) {
          stopIdleWorkers();
        }

        if (exitedWorkers === WORKER_COUNT) {
          resolve();
        }
      });
    }

    // Temporary crash-recovery test
    setTimeout(() => {
      const busyWorker = [...workerStates.entries()].find(
        ([, state]) => state.status === "BUSY"
      )?.[0];

      if (busyWorker) {
        console.log("[TEST] Simulating worker crash");
        void busyWorker.terminate();
      } else {
        console.log("[TEST] No busy worker found");
      }
    }, 1000);

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
    failedProcessingTimes.length > 0
      ? failedProcessingTimes.reduce((sum, time) => sum + time, 0) /
      failedProcessingTimes.length
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
    `Average failed worker processing time: ${averageFailedAttemptTime.toFixed(2)}ms`
  );


  console.log(`Total execution time: ${totalExecutionTime}ms`);

  console.log("\nFinal Inventory:");
  console.table(inventoryManager.getSnapshot());
}

main().catch((error) => {
  console.error("Application failed:", error);
  process.exitCode = 1;
});
