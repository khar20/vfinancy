package purchasing

import (
	"strings"
	"time"

	"github.com/google/uuid"

	derrors "vfinancy/backend/internal/domain/errors"
	"vfinancy/backend/internal/domain/valueobjects"
)

// ExtraCost is an ad-hoc surcharge recorded against a purchase order
// (freight, customs, handling). It is informational: it does not
// mutate the order's cost_usd / real_cost_pen nor card charges. The
// exchange rate snapshot is the USD->PEN rate at the moment the cost
// was assigned or last updated.
type ExtraCost struct {
	ID               uuid.UUID
	PurchaseOrderID  uuid.UUID
	Concept          string
	Amount           valueobjects.Money
	CurrencyCode     valueobjects.CurrencyCode
	ExchangeRate     valueobjects.ExchangeRate
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Validate checks the extra-cost invariants: a non-blank concept, a
// non-negative amount, an ISO 4217 currency code and a positive rate.
func (e *ExtraCost) Validate() error {
	if strings.TrimSpace(e.Concept) == "" {
		return derrors.Wrap(derrors.ErrRequired, errField("concept is required"))
	}
	if e.Amount.IsNegative() {
		return derrors.Wrap(derrors.ErrNegativeMoney, errField("amount cannot be negative"))
	}
	if e.CurrencyCode.IsZero() {
		return derrors.Wrap(derrors.ErrRequired, errField("currency is required"))
	}
	if !e.ExchangeRate.Decimal().IsPositive() {
		return derrors.Wrap(derrors.ErrOutOfRange, errField("exchange rate must be positive"))
	}
	return nil
}
