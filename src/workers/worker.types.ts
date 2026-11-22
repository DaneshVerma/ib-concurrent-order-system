import { Order } from "../models/order.model";

export type MainToWorkerMessage =
  | {
      type: "PROCESS";
      order: Order;
      inventoryIndex: number;
    }
  | {
      type: "STOP";
    };

export type WorkerToMainMessage =
  | {
      type: "READY";
    }
  | {
      type: "ORDER_COMPLETED";
      orderId: string;
      processingTime: number;
    }
  | {
      type: "ORDER_FAILED";
      orderId: string;
      error: string;
      processingTime: number;
    };
