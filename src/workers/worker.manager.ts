import path from "node:path";
import { Worker } from "node:worker_threads";

import { InventoryManager } from "../inventory/inventory.manager";
import { Order } from "../models/order.model";
import { OrderQueue } from "../queue/order.queue";
import {
  MainToWorkerMessage,
  WorkerState,
  WorkerToMainMessage
} from "./worker.types";

export interface ProcessingMetrics {
  completedProcessingTimes: number[];
  failedProcessingTimes: number[];
}

export class WorkerManager {
  private readonly workerFile = path.join(__dirname, "order.worker.js");
  private readonly workerStates = new Map<Worker, WorkerState>();
  private readonly orderMap: Map<string, Order>;
  private readonly completedProcessingTimes: number[] = [];
  private readonly failedProcessingTimes: number[] = [];

  constructor(
    private readonly queue: OrderQueue,
    private readonly inventoryManager: InventoryManager,
    orders: Order[],
    private readonly workerCount: number
  ) {
    this.orderMap = new Map(orders.map((order) => [order.id, order]));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      let exitedWorkers = 0;

      for (let i = 0; i < this.workerCount; i++) {
        const worker = new Worker(this.workerFile);

        this.workerStates.set(worker, { status: "IDLE" });

        worker.on("message", (message: WorkerToMainMessage) => {
          this.handleWorkerMessage(worker, message);
        });

        worker.on("error", (error) => {
          console.error("[MAIN] Worker error:", error);
        });

        worker.on("exit", (code) => {
          const state = this.workerStates.get(worker);

          if (state?.currentOrderId) {
            const order = this.orderMap.get(state.currentOrderId);

            if (order && order.status === "PROCESSING") {
              this.inventoryManager.release(order.id);
              order.status = "PENDING";
              this.queue.enqueue(order);
              console.log(`[MAIN] Requeued order ${order.id}`);
            }
          }

          if (state) {
            state.currentOrderId = undefined;
            state.status = "EXITED";
          }

          exitedWorkers++;

          if (code !== 0) {
            console.error(`[MAIN] Worker crashed with exit code ${code}`);
          }

          console.log(
            `[MAIN] Worker exited. (${exitedWorkers}/${this.workerCount})`
          );

          if (this.queue.size() > 0) {
            this.dispatchToIdleWorkers();
          } else if (this.getBusyWorkerCount() === 0) {
            this.stopIdleWorkers();
          }

          if (exitedWorkers === this.workerCount) {
            resolve();
          }
        });
      }

      // Temporary crash-recovery test
      setTimeout(() => {
        const busyWorker = [...this.workerStates.entries()].find(
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

  getProcessingMetrics(): ProcessingMetrics {
    return {
      completedProcessingTimes: [...this.completedProcessingTimes],
      failedProcessingTimes: [...this.failedProcessingTimes]
    };
  }

  private dispatchOrder(worker: Worker): void {
    const state = this.workerStates.get(worker);

    if (!state) {
      throw new Error("Unknown worker");
    }

    let order: Order | undefined;
    while ((order = this.queue.dequeue())) {
      if (this.inventoryManager.reserve(order.id, order.productId, order.quantity)) {
        break;
      }

      order.status = "FAILED";
      console.error(`[MAIN] Order ${order.id} failed: insufficient inventory`);
    }

    if (!order) {
      if (this.getBusyWorkerCount() > 0) {
        return;
      }

      state.status = "STOPPING";
      worker.postMessage({ type: "STOP" } satisfies MainToWorkerMessage);
      this.stopIdleWorkers();
      return;
    }

    order.status = "PROCESSING";
    state.status = "BUSY";
    state.currentOrderId = order.id;

    const message: MainToWorkerMessage = { type: "PROCESS", order };

    try {
      worker.postMessage(message);
    } catch (error) {
      console.error(`[MAIN] Failed to dispatch order ${order.id}:`, error);
      void worker.terminate().catch((terminationError) => {
        console.error("[MAIN] Failed to terminate worker:", terminationError);
      });
    }
  }

  private getOwnedOrder(worker: Worker, orderId: string): Order | undefined {
    const state = this.workerStates.get(worker);
    const order = this.orderMap.get(orderId);

    if (
      !state ||
      state.status !== "BUSY" ||
      state.currentOrderId !== orderId ||
      !order ||
      order.status !== "PROCESSING"
    ) {
      console.error(`[MAIN] Invalid result from worker for order ${orderId}`);
      return undefined;
    }

    return order;
  }

  private getBusyWorkerCount(): number {
    return [...this.workerStates.values()].filter(
      (state) => state.status === "BUSY"
    ).length;
  }

  private stopIdleWorkers(): void {
    for (const [worker, state] of this.workerStates) {
      if (state.status !== "IDLE") continue;

      state.status = "STOPPING";
      worker.postMessage({ type: "STOP" } satisfies MainToWorkerMessage);
    }
  }

  private dispatchToIdleWorkers(): void {
    for (const [worker, state] of this.workerStates) {
      if (state.status === "IDLE" && this.queue.size() > 0) {
        this.dispatchOrder(worker);
      }
    }
  }

  private handleWorkerMessage(
    worker: Worker,
    message: WorkerToMainMessage
  ): void {
    switch (message.type) {
      case "READY": {
        const state = this.workerStates.get(worker);

        if (!state || state.status !== "IDLE") {
          console.error("[MAIN] Unexpected READY message from worker");
          break;
        }

        this.dispatchOrder(worker);
        break;
      }

      case "ORDER_COMPLETED": {
        const order = this.getOwnedOrder(worker, message.orderId);

        if (!order) {
          break;
        }

        this.inventoryManager.commit(message.orderId);
        order.status = "COMPLETED";
        const state = this.workerStates.get(worker);

        if (state) {
          state.status = "IDLE";
          state.currentOrderId = undefined;
        }
        this.completedProcessingTimes.push(message.processingTime);

        console.log(
          `[MAIN] Order ${message.orderId} completed in ${message.processingTime}ms`
        );
        break;
      }

      case "ORDER_FAILED": {
        const order = this.getOwnedOrder(worker, message.orderId);

        if (!order) {
          break;
        }

        this.inventoryManager.release(message.orderId);
        order.status = "FAILED";
        const state = this.workerStates.get(worker);

        if (state) {
          state.status = "IDLE";
          state.currentOrderId = undefined;
        }
        this.failedProcessingTimes.push(message.processingTime);

        console.error(`[MAIN] Order ${message.orderId} failed: ${message.error}`);
        break;
      }
    }
  }
}
