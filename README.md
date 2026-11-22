# Concurrent Order Processing System

## Project Overview

This Node.js and TypeScript application simulates concurrent order processing for an IB Group technical assignment. It generates orders for 100 customers, queues them in memory, validates stock, and processes eligible orders with worker threads.

The main thread owns all mutable application state. `WorkerManager` runs in that main thread and coordinates workers; workers receive order copies and report results through messages.

## Features

- Generates 1-5 orders for each of 100 simulated customers.
- Processes orders with six worker threads (`WORKER_COUNT = 6`).
- Uses a FIFO in-memory queue with a moving head index for efficient dequeueing.
- Reserves inventory before dispatch and rejects orders that cannot be fulfilled.
- Tracks `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED` order states.
- Tracks worker states: `IDLE`, `BUSY`, `STOPPING`, and `EXITED`.
- Releases and requeues in-flight work when a worker exits unexpectedly.
- Prints processing metrics, a final order summary, and an inventory snapshot.

## Tech Stack

- Node.js worker threads (`node:worker_threads`)
- TypeScript 7.0.2
- Node.js type definitions 26.6.6
- CommonJS modules targeting ES2022
- npm

The project has no runtime npm dependencies.

## Project Structure

```text
.
├── src/
│   ├── main.ts                     # Application setup, orchestration, report output
│   ├── inventory/
│   │   └── inventory.manager.ts    # Product stock and reservations
│   ├── models/
│   │   ├── customer.model.ts
│   │   ├── order.model.ts
│   │   └── product.model.ts
│   ├── queue/
│   │   └── order.queue.ts          # FIFO order queue
│   ├── services/
│   │   ├── order-generator.ts      # Customer and order generation
│   │   └── report.service.ts       # Final report calculations
│   └── workers/
│       ├── order.worker.ts         # Worker-side simulated processing
│       ├── worker.manager.ts       # Main-thread worker lifecycle management
│       └── worker.types.ts         # Main/worker message and state types
├── logs/
│   ├── sample-run.log
│   └── crash-recovery.log
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 18 or later. The compiler targets ES2022 and the application uses worker threads. `package.json` does not declare an `engines` field.
- npm, included with Node.js.

## Installation and Execution

```bash
git clone <repository-url>
cd ib-concurrent-order-system
npm install
npm run build
npm start
```

To build and run in one command:

```bash
npm run dev
```

`build` runs `tsc`, `start` runs `node dist/main.js`, and `dev` runs the build before starting the application.

## Architecture and Design Decisions

### Application composition

`main.ts` creates the `OrderQueue`, generated orders, `InventoryManager`, and `WorkerManager`. It starts the manager, obtains processing metrics after all workers exit, delegates final calculations to `createFinalReport`, and prints the final report.

`WorkerManager` receives the queue, inventory manager, orders, and worker count through its constructor. It owns worker references, worker-state tracking, the order lookup map, and elapsed-time collections. Its `start()` method resolves only after every configured worker has exited.

### Order generation and queueing

`generateOrders(100)` creates customers with IDs such as `CUS-001`. Each customer produces 1-5 orders. Orders use one of three product IDs, request a quantity from 1-5, and begin with `PENDING` status.

The main thread enqueues all generated orders before starting workers. `OrderQueue` appends at the tail and advances a head index when dequeuing, so it preserves FIFO order without repeated array shifting. Recovered orders are appended to the queue tail.

### Dispatch and worker communication

Workers send `READY` at startup and after each processing attempt. `WorkerManager` dispatches an order only to a worker whose tracked state is `IDLE`.

Before sending `PROCESS`, it reserves stock, sets the order to `PROCESSING`, records the worker as `BUSY`, and stores `currentOrderId`. Orders that cannot reserve inventory become `FAILED` and are not sent to a worker.

Workers simulate processing for a random 2-5 seconds. They send either `ORDER_COMPLETED` or `ORDER_FAILED`, then send `READY`. The protocol also supports `STOP`, which causes the worker to close its message port.

The queue, inventory manager, order map, and worker-state map are mutated only on the main thread. Orders are transferred to workers through `postMessage`, so workers do not share these data structures. This design avoids concurrent mutation without `SharedArrayBuffer`, `Atomics`, or mutexes.

### Inventory and outcome handling

`InventoryManager` starts with 50 laptops, 100 mice, and 75 keyboards. Reservation validates the product and positive integer quantity, accounts for outstanding reservations, and prevents reserved stock from exceeding physical stock.

Before accepting a worker result, `WorkerManager` validates that the reporting worker is `BUSY`, owns the same `currentOrderId`, and that the order is still `PROCESSING`. This prevents a stale or duplicate result from being handled as the active assignment.

- Completion commits the reservation, deducts stock, marks the order `COMPLETED`, clears `currentOrderId`, and records successful processing time.
- Worker-reported failure releases the reservation, marks the order `FAILED`, clears `currentOrderId`, and records failed-attempt time.

### Recovery and shutdown

The worker exit handler checks whether the exited worker owned an order still marked `PROCESSING`. If so, it releases the reservation, restores the order to `PENDING`, and requeues it. Remaining idle workers are then asked to dispatch queued work.

The application does not replace a worker that exits. Processing continues with remaining workers. When the queue is empty, idle workers wait while any worker remains `BUSY`; after all work is complete, `WorkerManager` sends `STOP` to idle workers and resolves after all workers have exited.

## Order Lifecycle

```text
PENDING -> PROCESSING -> COMPLETED
                      -> FAILED
```

Inventory shortage follows `PENDING -> FAILED` directly. A worker crash while an order is processing follows `PROCESSING -> PENDING` after its reservation is released and the order is requeued.

## Final Reporting

`report.service.ts` calculates completed, failed, and pending totals, plus successful and failed worker-attempt averages. `main.ts` supplies total execution time and the final inventory snapshot.

## Assumptions and Limitations

- All state is in memory and is lost when the process exits.
- The simulation has no database, API, payment flow, or other external side effects.
- Requeueing after a worker exit is not a durable exactly-once delivery guarantee. An interrupted worker may have started work before its result reaches the main thread.
- Result validation prevents duplicate terminal handling during the running process, but does not persist idempotency across process restarts.
- Failed inventory reservations have no worker processing time; the failed-attempt average includes only worker-reported failures.
- A crashed worker is not automatically replaced.

## Sample Output

Order counts and timings vary because orders and processing delays are random. A stored run in `logs/sample-run.log` reports, for example:

```text
========== FINAL REPORT ==========
Total orders: 302
Total processed: 302
Completed: 79
Failed: 223
Pending: 0
Average successful processing time: 3472.94ms
Average failed worker processing time: 0.00ms
```

## Future Improvements

- Persist orders, reservations, and terminal outcomes.
- Replace crashed workers to maintain configured capacity.
- Add automated tests for inventory invariants, result ownership, recovery, and shutdown.
- Add bounded retries and a dead-letter flow for failures that should be retried.
- Add structured application logging and operational metrics.
