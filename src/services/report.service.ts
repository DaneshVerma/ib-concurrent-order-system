import { Order } from "../models/order.model";

export interface FinalReport {
  completed: number;
  failed: number;
  pending: number;
  totalProcessed: number;
  averageSuccessfulProcessingTime: number;
  averageFailedAttemptTime: number;
}

export function createFinalReport(
  orders: Order[],
  completedProcessingTimes: number[],
  failedProcessingTimes: number[]
): FinalReport {
  const completed = orders.filter(
    (order) => order.status === "COMPLETED"
  ).length;
  const failed = orders.filter((order) => order.status === "FAILED").length;
  const pending = orders.filter((order) => order.status === "PENDING").length;
  const totalSuccessfulProcessingTime = completedProcessingTimes.reduce(
    (sum, time) => sum + time,
    0
  );
  const totalFailedProcessingTime = failedProcessingTimes.reduce(
    (sum, time) => sum + time,
    0
  );

  return {
    completed,
    failed,
    pending,
    totalProcessed: completed + failed,
    averageSuccessfulProcessingTime:
      completed > 0 ? totalSuccessfulProcessingTime / completed : 0,
    averageFailedAttemptTime:
      failedProcessingTimes.length > 0
        ? totalFailedProcessingTime / failedProcessingTimes.length
        : 0
  };
}
