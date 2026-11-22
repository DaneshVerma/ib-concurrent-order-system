
import { Customer } from "../models/customer.model";
import { Order } from "../models/order.model";

const PRODUCT_IDS = [
    "PROD-001",
    "PROD-002",
    "PROD-003"
];

function randomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateOrders(
    customerCount: number
): Order[] {
    const orders: Order[] = [];

    for (let i = 1; i <= customerCount; i++) {
        const customer: Customer = {
            id: `CUS-${String(i).padStart(3, "0")}`,
            name: `Customer ${i}`
        };

        const orderCount = randomInteger(1, 5);

        for (let j = 1; j <= orderCount; j++) {
            const order: Order = {
                id: `ORD-${String(orders.length + 1).padStart(4, "0")}`,
                customerId: customer.id,
                productId:
                    PRODUCT_IDS[randomInteger(0, PRODUCT_IDS.length - 1)],
                quantity: randomInteger(1, 5),
                createdAt: new Date(),
                status: "PENDING"
            };

            orders.push(order);
        }
    }

    return orders;
}
