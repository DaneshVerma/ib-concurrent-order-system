# Concurrent Order Processing System

## Project Overview

This Node.js and TypeScript application simulates an order-processing system for an IB Group technical assignment. It generates orders for 100 customers, places them in an in-memory queue, and processes eligible orders concurrently with Node.js worker threads. The main thread remains the authoritative owner of order, inventory, queue, and worker-state data.

## Features

- Generates 1–5 orders for each of 100 simulated customers.
- Starts six worker threads (`WORKER_COUNT = 6`) to process orders concurrently.
- Uses a FIFO in-memory queue with constant-time dequeue via a moving head index.
- Reserves stock before dispatching an order; orders that cannot be reserved are marked `FAILED` without reaching a worker.
- Tracks each order through `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED` states.
- Maintains per-worker `IDLE`, `BUSY`, `STOPPING`, and `EXITED` state, including the active order ID while busy.
- Detects worker exits, releases an active reservation, and requeues a still-processing order.
- Prints processing-time metrics and a final inventory snapshot.

## Tech Stack

- Node.js worker threads (`node:worker_threads`)
- TypeScript 7.0.2
- Node.js type definitions 26.6.6
- CommonJS output targeting ES2022
- npm

The project has no runtime npm dependencies.

## Project Structure

```text
.
├── src/
│   ├── main.ts                     # Main-thread orchestration and reporting
│   ├── inventory/
│   │   └── inventory.manager.ts    # Stock and reservation management
│   ├── models/
│   │   ├── customer.model.ts       # Customer shape
│   │   ├── order.model.ts          # Order shape and lifecycle statuses
│   │   └── product.model.ts        # Product shape
│   ├── queue/
│   │   └── order.queue.ts          # FIFO in-memory order queue
│   ├── services/
│   │   └── order-generator.ts      # Random customer order generation
│   └── workers/
│       ├── order.worker.ts         # Worker processing loop
│       └── worker.types.ts         # Main/worker messages and worker state
├── logs/
│   ├── sample-run.log              # Stored normal-run output
│   └── crash-recovery.log          # Stored crash-recovery run output
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 18 or later. The compiler target is ES2022 and the application uses `node:worker_threads`. The project does not declare an `engines` field; Node.js 18+ is the practical baseline.
- npm, supplied with Node.js.

## Installation and Execution

```bash
git clone <repository-url>
cd ib-concurrent-order-system
npm install
npm run build
npm start
```

For a build followed by execution in one command:

```bash
npm run dev
```

`build` runs `tsc`, `start` runs `node dist/main.js`, and `dev` runs `npm run build && npm start`.

## Architecture and Design Decisions

### Order generation and queueing

`generateOrders(100)` creates customers with IDs such as `CUS-001`. For every customer it randomly creates 1–5 orders, each with a product selected from `PROD-001` through `PROD-003`, a quantity of 1–5, and initial status `PENDING`. The main thread enqueues every generated order before it starts workers.

`OrderQueue` appends at the tail and dequeues from a `head` index, preserving FIFO order without repeatedly shifting the array. Requeued crash-recovery orders are appended to the tail.

### Dispatch and worker communication

The main thread creates six `Worker` instances. A newly started worker sends `READY`; after processing an order it reports either `ORDER_COMPLETED` or `ORDER_FAILED`, then sends `READY` again. The main thread responds to `READY` by dispatching the next reservable order.

Before dispatch, the main thread calls `inventoryManager.reserve(order.id, order.productId, order.quantity)`. A successful reservation changes the order to `PROCESSING`, then records the worker as `BUSY` and stores `currentOrderId` before sending a `PROCESS` message. A failed reservation changes the order to `FAILED` and logs insufficient inventory without sending it to a worker.

Workers simulate work with a random 2–5 second delay. They return only a result message containing an order ID and elapsed time; they do not mutate the authoritative order or inventory state.

The queue, `InventoryManager`, order map, and worker-state map are exclusively owned and mutated by the main thread. Workers receive structured-cloned order data through `postMessage`. This single-owner model avoids concurrent mutations of those structures, so it does not require shared memory, `SharedArrayBuffer`, `Atomics`, or mutexes.

### Inventory and result handling

`InventoryManager` starts with three products: 50 laptops, 100 mice, and 75 keyboards. `reserve` validates the product and positive integer quantity, rejects duplicate reservations for an order, totals existing reservations for the product, and only creates a new reservation when unreserved stock is sufficient.

On an accepted completion result, the main thread validates that the reporting worker owns the matching `PROCESSING` order, commits the reservation by deducting stock, marks the order `COMPLETED`, clears the worker’s active order, and stores the processing time. On an accepted failure result, it releases the reservation without deducting stock, marks the order `FAILED`, clears the worker’s active order, and stores the failed-attempt time. Validating the worker state and current order prevents a stale or duplicate result from being handled as the current assignment.

### Worker state, recovery, and shutdown

`WorkerState` stores a status of `IDLE`, `BUSY`, `STOPPING`, or `EXITED`, plus an optional `currentOrderId`. The exit handler detects a worker exit. If its recorded order is still `PROCESSING`, the main thread releases its reservation, returns the order to `PENDING`, and requeues it. It then marks that worker `EXITED` and asks remaining idle workers to dispatch queued work.

The application does not create a replacement worker after an exit. It therefore recovers the in-flight order when capacity remains, but continues with fewer workers after a crash.

When the queue is empty, an idle worker waits while another worker is `BUSY`. Once no workers are busy, the main thread sends `STOP` to idle workers. A worker handles `STOP` by closing its message port; the main thread resolves the run after all six worker threads have exited.

## Order Lifecycle

```text
PENDING → PROCESSING → COMPLETED
                     └→ FAILED
```

An order moves from `PENDING` to `PROCESSING` only after inventory reservation succeeds. An inventory shortage produces `PENDING → FAILED` directly. A worker-reported failure follows `PROCESSING → FAILED` after reservation release.

If a worker exits while its recorded order is still `PROCESSING`, the main thread releases the reservation, restores the order to `PENDING`, and appends it to the queue for another live worker. This is requeueing, not a durable exactly-once guarantee: the system is in memory and a crash can occur after work has started but before a result has reached the main thread.

## Inventory Management

Reservations prevent multiple dispatched orders from claiming the same stock. Available inventory is calculated as physical stock minus all outstanding reservations.

- **Reservation:** validates stock before worker dispatch and records the order’s product and quantity.
- **Commit:** after a validated completion, deducts the reserved quantity from stock and removes the reservation.
- **Release:** after a worker-reported failure or worker exit, removes the reservation without changing stock.

This protects inventory consistency within one process because only the main thread performs these operations.

## Assumptions and Limitations

- All data is in memory. Orders, reservations, results, and worker state are lost when the process exits.
- The simulation has no database, payment flow, HTTP API, or other external side effects. It cannot provide distributed idempotency or exactly-once delivery for such effects.
- Result acceptance is guarded by the worker’s current assignment and the order’s `PROCESSING` status. This prevents duplicate terminal handling in the live process, but is not a persistent exactly-once protocol.
- Requeueing an order after a worker exit makes it eligible for another worker; it does not replace the crashed worker or guarantee that the interrupted work had no external effect.
- Processing time is random and simulated. The failed-worker average includes only worker-reported failures; stock-reservation failures have no worker processing time.
- The repository does not declare a Node.js version in `package.json`.


## Sample Output

The stored `logs/sample-run.log` contains this representative final report. Counts and timings vary because order generation and processing times are random.

```text
========== FINAL REPORT ==========
Total orders: 302
Total processed: 302
Completed: 79
Failed: 223
Pending: 0
Average successful processing time: 3472.94ms
Average failed worker processing time: 0.00ms
Total execution time: 48026ms

Final Inventory:
PROD-001  stock: 0  reserved: 0  available: 0
PROD-002  stock: 0  reserved: 0  available: 0
PROD-003  stock: 0  reserved: 0  available: 0
```

## Future Improvements

- Persist orders, reservations, and terminal results in a database.
- Add bounded retries, retry classification, and a dead-letter flow for repeatedly failing work.
- Replace failed workers to maintain the configured processing capacity.
- Add graceful process-signal handling and a timeout for unresponsive workers.
- Add automated tests for inventory invariants, result ownership, crash recovery, and shutdown coordination.
- Capture structured logs and expose metrics for queue depth, throughput, failures, and worker utilization.
