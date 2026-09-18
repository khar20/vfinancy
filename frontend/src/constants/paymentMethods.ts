type PaymentMethodCode = 'cash' | 'transfer' | 'other';

const PaymentMethods: Record<PaymentMethodCode, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  other: 'Otro',
};

export const PaymentMethodOptions = Object.entries(PaymentMethods).map(([value, label]) => ({
  value,
  label,
}));

type PurchasePaymentMethodCode = 'card' | 'cash' | 'digital_wallet';

const PurchasePaymentMethods: Record<PurchasePaymentMethodCode, string> = {
  card: 'Tarjeta de crédito',
  cash: 'Efectivo',
  digital_wallet: 'Billetera digital',
};

export const PurchasePaymentMethodOptions = Object.entries(PurchasePaymentMethods).map(([value, label]) => ({
  value,
  label,
}));
