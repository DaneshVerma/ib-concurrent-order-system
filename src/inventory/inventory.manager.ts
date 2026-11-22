
import { Product } from "../models/product.model";

export interface Reservation {
  orderId: string;
  productId: string;
  quantity: number;
}

export interface InventorySnapshot {
  productId: string;
  stock: number;
  reserved: number;
  available: number;
}

export class InventoryManager {
  private products = new Map<string, Product>();
  private reservations = new Map<string, Reservation>();

  constructor(products: Product[]) {
    for (const product of products) {
      this.products.set(product.id, { ...product });
    }
  }

  reserve(
    orderId: string,
    productId: string,
    quantity: number
  ): boolean {
    const product = this.products.get(productId);

    if (
      !product ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      this.reservations.has(orderId)
    ) {
      return false;
    }

    let reserved = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.productId === productId) {
        reserved += reservation.quantity;
      }
    }

    if (product.stock - reserved < quantity) {
      return false;
    }

    this.reservations.set(orderId, { orderId, productId, quantity });
    return true;
  }

  commit(orderId: string): void {
    const reservation = this.reservations.get(orderId);

    if (!reservation) {
      throw new Error(`Reservation not found: ${orderId}`);
    }

    const product = this.products.get(reservation.productId);

    if (!product) {
      throw new Error(`Product not found: ${reservation.productId}`);
    }

    product.stock -= reservation.quantity;
    this.reservations.delete(orderId);
  }

  release(orderId: string): void {
    this.reservations.delete(orderId);
  }

  getSnapshot(): InventorySnapshot[] {
    return Array.from(this.products.values()).map(product => {
      const reserved = Array.from(this.reservations.values())
        .filter(item => item.productId === product.id)
        .reduce((total, item) => total + item.quantity, 0);

      return {
        productId: product.id,
        stock: product.stock,
        reserved,
        available: product.stock - reserved
      };
    });
  }
}
