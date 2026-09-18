export type SaleStatus = 'paid' | 'pending' | 'partial' | 'cancelled';

export interface InventoryItem {
  id: string;
  productId: string;
  productSku: string;
  productDescription: string;
  quantity: number;
  unitCost: number;
  currencyCode: string;
  arrivalDate: string;
  maxSaleDate: string;
  ageDays: number;
  daysRemaining: number;
  isClearance: boolean;
  status: string;
}

export interface Sale {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  date: string;
  dueDate: string;
  status: SaleStatus;
  saleType: string;
  total: number;
  costTotal: number;
  profit: number;
  paid: number;
  balance: number;
}

export interface ChartPoint {
  label: string;
  value: number;
}
