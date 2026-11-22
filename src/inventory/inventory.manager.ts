
import { Product } from "../models/product.model";

export interface InventorySnapshot {
  productId: string;
  stock: number;
  reserved: number;
  available: number;
}

export class InventoryManager {
  private readonly buffer: SharedArrayBuffer;
  private readonly inventory: Int32Array;
  private readonly productIndexes: Map<string, number>;

  private static readonly SLOTS_PER_PRODUCT = 3;

  constructor(products: Product[]) {
    this.buffer = new SharedArrayBuffer(
      products.length *
        InventoryManager.SLOTS_PER_PRODUCT *
        Int32Array.BYTES_PER_ELEMENT
    );

    this.inventory = new Int32Array(this.buffer);
    this.productIndexes = new Map();

    products.forEach((product, index) => {
      const baseIndex =
        index * InventoryManager.SLOTS_PER_PRODUCT;

      this.productIndexes.set(product.id, baseIndex);

      // Slot 0: Physical stock
      Atomics.store(this.inventory, baseIndex, product.stock);

      // Slot 1: Reserved stock
      Atomics.store(this.inventory, baseIndex + 1, 0);

      // Slot 2: Lock
      Atomics.store(this.inventory, baseIndex + 2, 0);
    });
  }

  getSharedBuffer(): SharedArrayBuffer {
    return this.buffer;
  }

  getProductIndex(productId: string): number {
    const index = this.productIndexes.get(productId);

    if (index === undefined) {
      throw new Error(`Unknown product: ${productId}`);
    }

    return index;
  }

  getSnapshot(): InventorySnapshot[] {
    return Array.from(this.productIndexes.entries()).map(
      ([productId, baseIndex]) => {
        const stock = Atomics.load(this.inventory, baseIndex);
        const reserved = Atomics.load(
          this.inventory,
          baseIndex + 1
        );

        return {
          productId,
          stock,
          reserved,
          available: stock - reserved
        };
      }
    );
  }
}
