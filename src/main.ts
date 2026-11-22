import { InventoryManager } from "./inventory/inventory.manager";
import { OrderQueue } from "./queue/order.queue";
import { generateOrders } from "./services/order-generator";
import { createFinalReport } from "./services/report.service";
import { WorkerManager } from "./workers/worker.manager";

const WORKER_COUNT = 6;
const CUSTOMER_COUNT = 100;

const queue = new OrderQueue();
const orders = generateOrders(CUSTOMER_COUNT);

console.log(
  `[MAIN] Generated ${orders.length} orders from ${CUSTOMER_COUNT} customers`
);

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

orders.forEach((order) => queue.enqueue(order));

const workerManager = new WorkerManager(
  queue,
  inventoryManager,
  orders,
  WORKER_COUNT
);

const startedAt = Date.now();

async function main(): Promise<void> {
  console.log("\n Present Inventory:");
  console.table(inventoryManager.getSnapshot());
  console.log("\nStarting order processing...\n");

  await workerManager.start();

  const metrics = workerManager.getProcessingMetrics();
  const report = createFinalReport(
    orders,
    metrics.completedProcessingTimes,
    metrics.failedProcessingTimes
  );
  const totalExecutionTime = Date.now() - startedAt;

  console.log("\n========== FINAL REPORT ==========");
  console.log(`Total orders: ${orders.length}`);
  console.log(`Total processed: ${report.totalProcessed}`);
  console.log(`Completed: ${report.completed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Pending: ${report.pending}`);
  console.log(
    `Average successful processing time: ${report.averageSuccessfulProcessingTime.toFixed(2)}ms`
  );
  console.log(
    `Average failed worker processing time: ${report.averageFailedAttemptTime.toFixed(2)}ms`
  );
  console.log(`Total execution time: ${totalExecutionTime}ms`);

  console.log("\nFinal Inventory:");
  console.table(inventoryManager.getSnapshot());
}

main().catch((error) => {
  console.error("Application failed:", error);
  process.exitCode = 1;
});
