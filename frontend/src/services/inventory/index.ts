import type { InventoryBatchDTO, InventoryMovementDTO, ReceiveStockRequest } from '../wails-types';
import { wailsClient } from '../bindings';
import { fetchAllPages } from '../paginate';
import { productsService } from '../products';
import { daysBetween } from '@/utils/format';
import type { InventoryItem } from '@/types/domain';

function toItem(dto: InventoryBatchDTO, skuById: Map<string, string>): InventoryItem {
  const today = new Date().toISOString();
  return {
    id: dto.id,
    productId: dto.productId,
    productSku: skuById.get(dto.productId) ?? '',
    productDescription: dto.productDescription,
    quantity: dto.quantity,
    unitCost: dto.unitCost,
    currencyCode: 'PEN',
    arrivalDate: dto.arrivalDate,
    maxSaleDate: dto.maxSaleDate,
    ageDays: Math.max(0, daysBetween(dto.arrivalDate, today)),
    daysRemaining: dto.maxSaleDate ? daysBetween(today, dto.maxSaleDate) : 0,
    isClearance: dto.isClearance,
    status: dto.status,
  };
}

async function skuIndex(): Promise<Map<string, string>> {
  const { items } = await productsService.list();
  return new Map(items.map((p) => [p.id, p.sku]));
}

export const inventoryService = {
  async list(
    q: { search?: string; status?: string; page?: number; pageSize?: number } = {},
  ): Promise<InventoryItem[]> {
    const [items, skus] = await Promise.all([
      fetchAllPages((page, pageSize) =>
        wailsClient.listInventoryBatches({ page, pageSize }, q.status ?? '', q.search ?? ''),
      ),
      skuIndex(),
    ]);
    return (items as InventoryBatchDTO[]).map((dto) => toItem(dto, skus));
  },

  async movements(productId?: string): Promise<InventoryMovementDTO[]> {
    const res = await wailsClient.listInventoryMovements(
      { page: 1, pageSize: 200 },
      productId ?? '',
    );
    return res.items as InventoryMovementDTO[];
  },

  async receive(input: ReceiveStockRequest): Promise<void> {
    await wailsClient.receiveStock(input);
  },

  async adjust(batchId: string, newQuantity: number, notes: string): Promise<void> {
    await wailsClient.adjustStock({ batchId, newQuantity, notes });
  },

  async void(batchId: string, reason: string): Promise<void> {
    await wailsClient.voidStock({ batchId, reason });
  },
};
