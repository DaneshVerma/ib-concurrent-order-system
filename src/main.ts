import { OrderQueue } from "./queue/order.queue";
import { Order } from "./models/order.model";

const queue = new OrderQueue();

const order1: Order = {
  id: "ORD-001",
  customerId: "CUS-001",
  productId: "PROD-001",
  quantity: 2,
  createdAt: new Date(),
  status: "PENDING"
};

const order2: Order = {
  id: "ORD-002",
  customerId: "CUS-002",
  productId: "PROD-002",
  quantity: 1,
  createdAt: new Date(),
  status: "PENDING"
};

queue.enqueue(order1);
queue.enqueue(order2);

console.log("Queue size:", queue.size());

console.log("Dequeued:", queue.dequeue()?.id);
console.log("Dequeued:", queue.dequeue()?.id);

console.log("Is queue empty?", queue.isEmpty());