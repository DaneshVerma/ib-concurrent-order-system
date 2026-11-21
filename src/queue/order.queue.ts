import { Order } from "../models/order.model";

export class OrderQueue {
  private orders: Order[] = [];
  private head = 0;

  // Add an order to the end of the queue
  enqueue(order: Order): void {
    this.orders.push(order);

    console.log(`[QUEUE] Order ${order.id} added. Queue size: ${this.size()}`);
  }

  // Remove and return the oldest order
  dequeue(): Order | undefined {
    if (this.isEmpty()) {
      return undefined;
    }

    const order = this.orders[this.head];
    this.head++;

    return order;
  }

  // Check whether the queue is empty
  isEmpty(): boolean {
    return this.head >= this.orders.length;
  }

  // Return the number of pending orders
  size(): number {
    return this.orders.length - this.head;
  }
}
