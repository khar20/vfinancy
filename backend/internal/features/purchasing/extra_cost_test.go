package purchasing_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	derrors "vfinancy/backend/internal/domain/errors"
	"vfinancy/backend/internal/domain/enums"
	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/features/purchasing"
	"vfinancy/backend/internal/shared/apperrors"
)

func (f *fakeOrders) CreateExtraCost(_ context.Context, ec *purchasing.ExtraCost) error {
	if f.extraCosts == nil {
		f.extraCosts = map[uuid.UUID][]*purchasing.ExtraCost{}
	}
	f.extraCosts[ec.PurchaseOrderID] = append(f.extraCosts[ec.PurchaseOrderID], ec)
	return nil
}

func (f *fakeOrders) ListExtraCosts(_ context.Context, purchaseOrderID uuid.UUID) ([]*purchasing.ExtraCost, error) {
	return f.extraCosts[purchaseOrderID], nil
}

func mustRate(t *testing.T, n int64) valueobjects.ExchangeRate {
	t.Helper()
	r, err := valueobjects.ExchangeRateFromDecimal(decimal.NewFromInt(n))
	if err != nil {
		t.Fatalf("rate: %v", err)
	}
	return r
}

func seedOrder(t *testing.T, orders *fakeOrders) *purchasing.PurchaseOrder {
	t.Helper()
	po := &purchasing.PurchaseOrder{
		ID:           uuid.New(),
		Number:       "PO-2026-00001",
		OrderDate:    time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC),
		Status:       enums.PurchaseStatusPending,
		CurrencyCode: purchasing.USD,
		ExchangeRate: mustRate(t, 3),
	}
	if orders.byID == nil {
		orders.byID = map[uuid.UUID]*purchasing.PurchaseOrder{}
		orders.items = map[uuid.UUID][]*purchasing.PurchaseOrderItem{}
	}
	orders.byID[po.ID] = po
	return po
}

func TestAddExtraCostSnapshotsRateAndValidates(t *testing.T) {
	orders := &fakeOrders{}
	po := seedOrder(t, orders)
	svc := newService(orders, &fakeTreasury{}, &fakeStock{})
	current := mustRate(t, 4)
	svc.SetRateProvider(func(context.Context) valueobjects.ExchangeRate { return current })
	ctx := context.Background()

	ec, err := svc.AddExtraCost(ctx, po.ID, purchasing.ExtraCostInput{
		Concept:      "Flete",
		Amount:       money("10.00"),
		CurrencyCode: valueobjects.USD,
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if !ec.ExchangeRate.Decimal().Equal(current.Decimal()) {
		t.Fatalf("rate = %s, want current 4", ec.ExchangeRate.Decimal())
	}

	requested := mustRate(t, 5)
	ec2, err := svc.AddExtraCost(ctx, po.ID, purchasing.ExtraCostInput{
		Concept:      "Arancel",
		Amount:       money("20.00"),
		CurrencyCode: valueobjects.PEN,
		ExchangeRate: requested,
	})
	if err != nil {
		t.Fatalf("add with rate: %v", err)
	}
	if !ec2.ExchangeRate.Decimal().Equal(requested.Decimal()) {
		t.Fatalf("rate = %s, want requested 5", ec2.ExchangeRate.Decimal())
	}

	if _, err := svc.AddExtraCost(ctx, po.ID, purchasing.ExtraCostInput{
		Concept:      "   ",
		Amount:       money("1.00"),
		CurrencyCode: valueobjects.USD,
	}); !derrors.IsCode(err, derrors.ErrRequired.Code()) {
		t.Fatalf("blank concept: want REQUIRED, got %v", err)
	}

	if err := po.Cancel("anulada", time.Now()); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := svc.AddExtraCost(ctx, po.ID, purchasing.ExtraCostInput{
		Concept:      "Flete",
		Amount:       money("1.00"),
		CurrencyCode: valueobjects.USD,
	}); !errors.Is(err, apperrors.ErrConflict) {
		t.Fatalf("cancelled order: want conflict, got %v", err)
	}

	if _, err := svc.AddExtraCost(ctx, uuid.Nil, purchasing.ExtraCostInput{Concept: "X"}); !errors.Is(err, apperrors.ErrValidation) {
		t.Fatalf("nil id: want validation error, got %v", err)
	}
}
