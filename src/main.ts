import { Order } from "./models/order.model";
import { Product } from "./models/product.model";

const order: Order = {
  id: "ORD-001",
  customerId: "CUS-001",
  productId: "PROD-001",
  quantity: 2,
  createdAt: new Date(),
  status: "PENDING",
};

const product: Product = {
  id: "PROD-001",
  name: "Laptop",
  price: 50000,
  stock: 20,
};

console.log("Order:", order);
console.log("Product:", product);
