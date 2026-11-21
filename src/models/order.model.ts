export type OrderStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Order {
  id: string;
  customerId: string;
  productId: string;
  quantity: number;
  createdAt: Date;
  status: OrderStatus;
}
