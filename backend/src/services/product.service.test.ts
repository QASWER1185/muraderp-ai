import { describe, expect, it, vi } from "vitest";
import { ProductService } from "./product.service.js";
import type { ProductRepository } from "../repositories/product.repository.js";
import type { ProductRecord } from "../types/product.types.js";

const product: ProductRecord = {
  id: 1,
  name: "Bestway Cement",
  sku: "BESTWAY-OPC",
  category: "Cement",
  unit: "bag",
  purchase_price: 1420,
  sale_price: 1500,
  brand_id: 7,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};

function repository(): ProductRepository {
  return {
    create: vi.fn(async () => product),
    getById: vi.fn(async () => product),
    list: vi.fn(async () => [product]),
    update: vi.fn(async () => product),
    delete: vi.fn(async () => true),
  };
}

describe("ProductService", () => {
  it("normalizes and persists a valid product", async () => {
    const repo = repository();
    const service = new ProductService(repo);
    await expect(service.create({
      name: "  Bestway Cement ",
      sku: " BESTWAY-OPC ",
      category: " Cement ",
      unit: " bag ",
      purchase_price: 1420,
      sale_price: 1500,
      brand_id: 7,
    })).resolves.toEqual(product);
    expect(repo.create).toHaveBeenCalledWith({
      name: "Bestway Cement",
      sku: "BESTWAY-OPC",
      category: "Cement",
      unit: "bag",
      purchase_price: 1420,
      sale_price: 1500,
      brand_id: 7,
    });
  });

  it("rejects missing identity fields and negative prices", async () => {
    const service = new ProductService(repository());
    await expect(service.create({ name: "", sku: "A", category: "Cement", unit: "bag", purchase_price: 1, sale_price: 2 })).rejects.toThrow("name is required");
    await expect(service.create({ name: "A", sku: "A", category: "Cement", unit: "bag", purchase_price: -1, sale_price: 2 })).rejects.toThrow("purchase_price must be zero or greater");
    await expect(service.create({ name: "A", sku: "A", category: "Cement", unit: "bag", purchase_price: 1, sale_price: -2 })).rejects.toThrow("sale_price must be zero or greater");
  });

  it("validates identifiers and supports filtered listing", async () => {
    const repo = repository();
    const service = new ProductService(repo);
    await expect(service.getById(0)).rejects.toThrow("id must be a positive integer");
    await service.list({ search: "cement", category: " Cement ", brand_id: 7 });
    expect(repo.list).toHaveBeenCalledWith({ search: "cement", category: "Cement", brand_id: 7 });
  });

  it("validates update input before persistence", async () => {
    const service = new ProductService(repository());
    await expect(service.update(1, {})).rejects.toThrow("at least one field is required");
    await expect(service.update(1, { sale_price: -1 })).rejects.toThrow("sale_price must be zero or greater");
  });
});
