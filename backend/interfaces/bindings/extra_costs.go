package bindings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shopspring/decimal"

	"vfinancy/backend/internal/domain/valueobjects"
	"vfinancy/backend/internal/features/purchasing"
)

// ExtraCostDTO is one ad-hoc surcharge recorded against a purchase
// order. The exchange rate is the USD->PEN snapshot taken when the
// cost was assigned or last updated.
type ExtraCostDTO struct {
	ID              string  `json:"id"`
	PurchaseOrderID string  `json:"purchaseOrderId"`
	Concept         string  `json:"concept"`
	Amount          float64 `json:"amount"`
	CurrencyCode    string  `json:"currencyCode"`
	ExchangeRate    float64 `json:"exchangeRate"`
}

func extraCostDTO(ec *purchasing.ExtraCost) ExtraCostDTO {
	return ExtraCostDTO{
		ID:              ec.ID.String(),
		PurchaseOrderID: ec.PurchaseOrderID.String(),
		Concept:         ec.Concept,
		Amount:          moneyFloat(ec.Amount),
		CurrencyCode:    ec.CurrencyCode.String(),
		ExchangeRate:    ec.ExchangeRate.Decimal().InexactFloat64(),
	}
}

type ExtraCostRequest struct {
	Concept      string  `json:"concept"`
	Amount       float64 `json:"amount"`
	CurrencyCode string  `json:"currencyCode"`
	ExchangeRate float64 `json:"exchangeRate"`
}

func (r ExtraCostRequest) input() (purchasing.ExtraCostInput, error) {
	amount, err := moneyFromFloat(r.Amount)
	if err != nil {
		return purchasing.ExtraCostInput{}, err
	}
	cc, err := valueobjects.NewCurrencyCode(r.CurrencyCode)
	if err != nil {
		return purchasing.ExtraCostInput{}, err
	}
	// A non-positive rate stays zero so the service snapshots the
	// current USD->PEN rate instead of freezing a 1.0 placeholder.
	var rate valueobjects.ExchangeRate
	if r.ExchangeRate > 0 {
		if rate, err = valueobjects.ExchangeRateFromDecimal(decimal.NewFromFloat(r.ExchangeRate)); err != nil {
			return purchasing.ExtraCostInput{}, err
		}
	}
	return purchasing.ExtraCostInput{
		Concept:      strings.TrimSpace(r.Concept),
		Amount:       amount,
		CurrencyCode: cc,
		ExchangeRate: rate,
	}, nil
}

// ListPurchaseExtraCosts returns the extra costs of one order.
func (a *App) ListPurchaseExtraCosts(purchaseId string) ([]ExtraCostDTO, error) {
	oid, err := parseUUID(purchaseId)
	if err != nil {
		return nil, err
	}
	costs, err := a.purchasingSvc.ListExtraCosts(a.Context(), oid)
	if err != nil {
		return nil, err
	}
	out := make([]ExtraCostDTO, 0, len(costs))
	for _, ec := range costs {
		out = append(out, extraCostDTO(ec))
	}
	return out, nil
}

// AddPurchaseExtraCost attaches an extra cost to an order.
func (a *App) AddPurchaseExtraCost(purchaseId string, req ExtraCostRequest) (ExtraCostDTO, error) {
	oid, err := parseUUID(purchaseId)
	if err != nil {
		return ExtraCostDTO{}, err
	}
	in, err := req.input()
	if err != nil {
		return ExtraCostDTO{}, err
	}
	ec, err := a.purchasingSvc.AddExtraCost(a.Context(), oid, in)
	if err != nil {
		return ExtraCostDTO{}, err
	}
	return extraCostDTO(ec), nil
}

// UpdatePurchaseExtraCost rewrites one extra cost of an order.
func (a *App) UpdatePurchaseExtraCost(purchaseId string, costId string, req ExtraCostRequest) (ExtraCostDTO, error) {
	oid, err := parseUUID(purchaseId)
	if err != nil {
		return ExtraCostDTO{}, err
	}
	cid, err := parseUUID(costId)
	if err != nil {
		return ExtraCostDTO{}, err
	}
	in, err := req.input()
	if err != nil {
		return ExtraCostDTO{}, err
	}
	ec, err := a.purchasingSvc.UpdateExtraCost(a.Context(), oid, cid, in)
	if err != nil {
		return ExtraCostDTO{}, err
	}
	return extraCostDTO(ec), nil
}

// DeletePurchaseExtraCost removes one extra cost from an order.
func (a *App) DeletePurchaseExtraCost(purchaseId string, costId string) error {
	oid, err := parseUUID(purchaseId)
	if err != nil {
		return err
	}
	cid, err := parseUUID(costId)
	if err != nil {
		return err
	}
	return a.purchasingSvc.DeleteExtraCost(a.Context(), oid, cid)
}

// ExtraCostConcept is a recently used extra-cost concept kept in the
// local catalog file so the autocomplete can offer it together with
// its last amount and currency.
type ExtraCostConcept struct {
	Concept  string  `json:"concept"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

// maxExtraCostConcepts caps the local catalog; the oldest entries
// fall off the end.
const maxExtraCostConcepts = 20

func extraCostConceptsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("bindings: user config dir: %w", err)
	}
	return filepath.Join(dir, "vfinancy", "extra-cost-concepts.json"), nil
}

// GetExtraCostConcepts returns the local catalog of recently used
// extra-cost concepts, most recently saved first.
func (a *App) GetExtraCostConcepts() ([]ExtraCostConcept, error) {
	path, err := extraCostConceptsPath()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []ExtraCostConcept{}, nil
		}
		return nil, fmt.Errorf("bindings: read extra-cost concepts: %w", err)
	}
	var out []ExtraCostConcept
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("bindings: parse extra-cost concepts: %w", err)
	}
	if out == nil {
		out = []ExtraCostConcept{}
	}
	return out, nil
}

// SaveExtraCostConcept upserts a concept in the local catalog: an
// existing concept keeps its position and takes the new amount and
// currency; a new one is prepended. The list is capped at
// maxExtraCostConcepts entries.
func (a *App) SaveExtraCostConcept(c ExtraCostConcept) error {
	c.Concept = strings.TrimSpace(c.Concept)
	if c.Concept == "" {
		return fmt.Errorf("bindings: concept is required")
	}
	c.Currency = strings.ToUpper(strings.TrimSpace(c.Currency))
	list, err := a.GetExtraCostConcepts()
	if err != nil {
		return err
	}
	kept := make([]ExtraCostConcept, 0, len(list)+1)
	kept = append(kept, c)
	for _, e := range list {
		if strings.EqualFold(e.Concept, c.Concept) {
			continue
		}
		kept = append(kept, e)
	}
	if len(kept) > maxExtraCostConcepts {
		kept = kept[:maxExtraCostConcepts]
	}
	path, err := extraCostConceptsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("bindings: create concepts dir: %w", err)
	}
	raw, err := json.MarshalIndent(kept, "", "  ")
	if err != nil {
		return fmt.Errorf("bindings: encode concepts: %w", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return fmt.Errorf("bindings: write concepts: %w", err)
	}
	return nil
}
