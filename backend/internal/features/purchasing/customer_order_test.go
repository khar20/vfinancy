package purchasing_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"vfinancy/backend/infrastructure/logger"
	"vfinancy/backend/internal/domain/enums"
	"vfinancy/backend/internal/domain/repositories"
	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/features/inventory"
	"vfinancy/backend/internal/features/product"
	"vfinancy/backend/internal/features/purchasing"
	"vfinancy/backend/internal/shared/apperrors"
)

type fakeTx struct{}

func (fakeTx) WithinTransaction(ctx context.Context, fn repositories.TxRunner) error { return fn(ctx) }

type fakeTreasury struct {
	charges    []valueobjects.Money
	releases   []valueobjects.Money
	cycleStart time.Time
	cycleErr   error
}

func (f *fakeTreasury) ChargeCard(_ context.Context, _ uuid.UUID, amount valueobjects.Money) error {
	f.charges = append(f.charges, amount)
	return nil
}

func (f *fakeTreasury) ReleaseCardCharge(_ context.Context, _ uuid.UUID, amount valueobjects.Money) error {
	f.releases = append(f.releases, amount)
	return nil
}

func (f *fakeTreasury) CurrentCycleStart(_ context.Context, _ uuid.UUID) (time.Time, error) {
	return f.cycleStart, f.cycleErr
}

type fakeProducts struct{}

func (fakeProducts) GetOrCreate(_ context.Context, in product.CreateInput) (*product.Product, error) {
	return &product.Product{ID: uuid.New(), Description: in.Description, CostUSD: in.CostUSD, SalePrice: in.SalePrice}, nil
}

func (fakeProducts) GetByID(_ context.Context, id uuid.UUID) (*product.Product, error) {
	return &product.Product{ID: id, Description: "Cosa importada", CostUSD: money("4.00")}, nil
}

type fakeStock struct {
	received int
	voided   int
}

func (f *fakeStock) ReceiveFromPurchase(context.Context, inventory.ReceiveFromPurchaseInput) (*inventory.InventoryBatch, error) {
	f.received++
	return nil, nil
}

func (f *fakeStock) VoidPurchaseReceipt(context.Context, []uuid.UUID) error {
	f.voided++
	return nil
}

type fakeOrders struct {
	purchasing.PurchaseRepository
	seq     int
	created []*purchasing.PurchaseOrder
	byID    map[uuid.UUID]*purchasing.PurchaseOrder
	items   map[uuid.UUID][]*purchasing.PurchaseOrderItem
	updated []*purchasing.PurchaseOrder
}

func (f *fakeOrders) NextNumber(context.Context) (string, error) {
	f.seq++
	return "PO-2026-" + string(rune('0'+f.seq)), nil
}

func (f *fakeOrders) Create(_ context.Context, po *purchasing.PurchaseOrder, items []*purchasing.PurchaseOrderItem) error {
	f.created = append(f.created, po)
	if f.byID == nil {
		f.byID = map[uuid.UUID]*purchasing.PurchaseOrder{}
		f.items = map[uuid.UUID][]*purchasing.PurchaseOrderItem{}
	}
	f.byID[po.ID] = po
	f.items[po.ID] = items
	return nil
}

func (f *fakeOrders) GetByID(_ context.Context, id uuid.UUID) (*purchasing.PurchaseOrder, error) {
	po, ok := f.byID[id]
	if !ok {
		return nil, repositories.ErrNotFound
	}
	return po, nil
}

func (f *fakeOrders) ListItems(_ context.Context, purchaseOrderID uuid.UUID) ([]*purchasing.PurchaseOrderItem, error) {
	return f.items[purchaseOrderID], nil
}

func (f *fakeOrders) Update(_ context.Context, po *purchasing.PurchaseOrder) error {
	f.updated = append(f.updated, po)
	f.byID[po.ID] = po
	return nil
}

func (f *fakeOrders) UpdateItemReceipt(_ context.Context, _ uuid.UUID, _ valueobjects.Quantity) error {
	return nil
}

func money(s string) valueobjects.Money {
	m, err := valueobjects.MoneyFromString(s)
	if err != nil {
		panic(err)
	}
	return m
}

func newService(orders *fakeOrders, treasury *fakeTreasury, stock *fakeStock) *purchasing.PurchasingService {
	svc := purchasing.New(orders, stock, fakeTx{}, logger.NewLogger(slog.New(slog.NewTextHandler(io.Discard, nil))))
	products := fakeProducts{}
	svc.SetProducts(products, products)
	svc.SetTreasury(treasury)
	return svc
}

func TestCreateRequiresCreditCard(t *testing.T) {
	svc := newService(&fakeOrders{}, &fakeTreasury{}, &fakeStock{})
	_, err := svc.Create(context.Background(), purchasing.CreateInput{
		ExchangeRate: valueobjects.One(),
		Items: []purchasing.CreateItemInput{{
			Description: "Cosa", Quantity: valueobjects.QuantityFromInt64(1), UnitCostUSD: money("10.00"),
		}},
	})
	if !errors.Is(err, apperrors.ErrValidation) {
		t.Fatalf("want validation error, got %v", err)
	}
}

func TestCreateChargesCardWithOrderCost(t *testing.T) {
	rate, _ := valueobjects.ExchangeRateFromDecimal(decimal.NewFromInt(3))
	cardID := uuid.New()
	supplierID := uuid.New()
	orders := &fakeOrders{}
	treasury := &fakeTreasury{}
	svc := newService(orders, treasury, &fakeStock{})
	po, err := svc.Create(context.Background(), purchasing.CreateInput{
		CreditCardID: &cardID,
		SupplierID:   &supplierID,
		ExchangeRate: rate,
		Items: []purchasing.CreateItemInput{{
			Description:  "Cosa",
			Quantity:     valueobjects.QuantityFromInt64(2),
			UnitCostUSD:  money("10.00"),
			SalePricePen: money("100.00"),
		}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !po.CostUSD.Equals(money("20.00")) {
		t.Fatalf("cost_usd = %s, want 20.00", po.CostUSD)
	}
	if !po.RealCostPen.Equals(money("60.21")) {
		t.Fatalf("real_cost_pen = %s, want 60.21", po.RealCostPen)
	}
	if len(treasury.charges) != 1 || !treasury.charges[0].Equals(money("20.00")) {
		t.Fatalf("charges = %v, want [20.00]", treasury.charges)
	}
}

func TestCancelRefundsWhenCycleSettled(t *testing.T) {
	cardID := uuid.New()
	cycleStart := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	orders := &fakeOrders{byID: map[uuid.UUID]*purchasing.PurchaseOrder{}, items: map[uuid.UUID][]*purchasing.PurchaseOrderItem{}}
	treasury := &fakeTreasury{cycleStart: cycleStart}
	svc := newService(orders, treasury, &fakeStock{})

	orderDate := time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)
	po := &purchasing.PurchaseOrder{
		ID:           uuid.New(),
		Number:       "PO-2026-00001",
		OrderDate:    orderDate,
		Status:       enums.PurchaseStatusReceived,
		CurrencyCode: purchasing.USD,
		ExchangeRate: valueobjects.One(),
		CostUSD:      money("50.00"),
		CreditCardID: &cardID,
	}
	item := &purchasing.PurchaseOrderItem{ID: uuid.New(), PurchaseOrderID: po.ID, Description: "Cosa", QuantityOrdered: valueobjects.QuantityFromInt64(1)}
	orders.byID[po.ID] = po
	orders.items[po.ID] = []*purchasing.PurchaseOrderItem{item}

	out, err := svc.Cancel(context.Background(), po.ID, "pedido equivocado")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if out.Status != enums.PurchaseStatusCancelled || out.CancelledAt == nil {
		t.Fatalf("status = %s, want cancelled", out.Status)
	}
	if len(treasury.releases) != 1 || !treasury.releases[0].Equals(money("50.00")) {
		t.Fatalf("releases = %v, want [50.00]", treasury.releases)
	}
	if !out.RefundAmount.Equals(money("50.00")) {
		t.Fatalf("refund_amount = %s, want 50.00", out.RefundAmount)
	}

	// Same-cycle order: released but no refund.
	po2 := &purchasing.PurchaseOrder{
		ID:           uuid.New(),
		Number:       "PO-2026-00002",
		OrderDate:    time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC),
		Status:       enums.PurchaseStatusPending,
		CurrencyCode: purchasing.USD,
		ExchangeRate: valueobjects.One(),
		CostUSD:      money("30.00"),
		CreditCardID: &cardID,
	}
	orders.byID[po2.ID] = po2
	orders.items[po2.ID] = nil
	out2, err := svc.Cancel(context.Background(), po2.ID, "duplicado")
	if err != nil {
		t.Fatalf("cancel 2: %v", err)
	}
	if len(treasury.releases) != 2 {
		t.Fatalf("releases = %d, want 2", len(treasury.releases))
	}
	if !out2.RefundAmount.IsZero() {
		t.Fatalf("refund_amount = %s, want zero", out2.RefundAmount)
	}
}
