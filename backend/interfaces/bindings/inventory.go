package bindings

import (
	"context"
	"time"

	"vfinancy/backend/internal/features/inventory"
)

type PreferencesDTO struct {
	ClearanceDays        int     `json:"clearanceDays"`
	ClearanceWarningDays int     `json:"clearanceWarningDays"`
	ImportCostFactor     float64 `json:"importCostFactor"`
	FallbackExchangeRate float64 `json:"fallbackExchangeRate"`
	PurchaseLimitUSD     float64 `json:"purchaseLimitUSD"`
	BackupFolder         string  `json:"backupFolder"`
	BackupFrequency      string  `json:"backupFrequency"`
}

func (a *App) preferencesDTO(ctx context.Context) (PreferencesDTO, error) {
	prefs, err := a.settingsSvc.GetPreferences(ctx)
	if err != nil {
		return PreferencesDTO{}, err
	}
	return PreferencesDTO{
		ClearanceDays:        prefs.ClearanceDays,
		ClearanceWarningDays: prefs.ClearanceWarningDays,
		ImportCostFactor:     prefs.ImportCostFactor,
		FallbackExchangeRate: prefs.FallbackExchangeRate,
		PurchaseLimitUSD:     prefs.PurchaseLimitUSD,
		BackupFolder:         prefs.BackupFolder,
		BackupFrequency:      prefs.BackupFrequency,
	}, nil
}

// GetPreferences returns the business parameters (edge-case driven:
// clearance days, import cost factor, fallback rate, purchase cap,
// backup policy).
func (a *App) GetPreferences() (PreferencesDTO, error) {
	return a.preferencesDTO(a.Context())
}

// UpdatePreference stores one business parameter by key. Changing the
// clearance threshold recomputes the clearance flags immediately
// (edge case 4.2: no app restart).
func (a *App) UpdatePreference(key string, value interface{}) (PreferencesDTO, error) {
	ctx := a.Context()
	if err := a.settingsSvc.UpdatePreference(ctx, key, value); err != nil {
		return PreferencesDTO{}, err
	}
	if key == "clearance_days" || key == "clearance_warning_days" {
		if _, err := a.inventorySvc.RefreshClearanceFlags(ctx, time.Now().UTC()); err != nil {
			a.log.Warn("clearance refresh after settings change failed", "error", err.Error())
		}
	}
	return a.preferencesDTO(ctx)
}

type InventoryBatchDTO struct {
	ID                  string  `json:"id"`
	ProductID           string  `json:"productId"`
	ProductDescription  string  `json:"productDescription"`
	PurchaseOrderItemID string  `json:"purchaseOrderItemId"`
	ArrivalDate         string  `json:"arrivalDate"`
	Quantity            float64 `json:"quantity"`
	OriginalQuantity    float64 `json:"originalQuantity"`
	UnitCost            float64 `json:"unitCost"`
	Status              string  `json:"status"`
	IsClearance         bool    `json:"isClearance"`
	MaxSaleDate         string  `json:"maxSaleDate"`
}

type InventoryMovementDTO struct {
	ID           string  `json:"id"`
	BatchID      string  `json:"batchId"`
	ProductID    string  `json:"productId"`
	MovementDate string  `json:"movementDate"`
	Type         string  `json:"type"`
	Quantity     float64 `json:"quantity"`
	BalanceAfter float64 `json:"balanceAfter"`
	UnitCost     float64 `json:"unitCost"`
	Notes        string  `json:"notes"`
}

type ProductRefDTO struct {
	ID          string  `json:"id"`
	SKU         string  `json:"sku"`
	Description string  `json:"description"`
	UnitCode    string  `json:"unitCode"`
	CostUSD     float64 `json:"costUsd"`
	SalePrice   float64 `json:"salePrice"`
	Stock       float64 `json:"stock"`
}

// ListInventoryBatches returns the kardex batches. status filters to
// the voided register, or to the active+depleted stock otherwise.
func (a *App) ListInventoryBatches(req PaginationRequest, status string, search string) (PageResult, error) {
	statuses := []string{"active", "depleted"}
	if status == "voided" {
		statuses = []string{"voided"}
	}
	page, err := a.inventorySvc.ListBatches(a.Context(), inventory.InventoryBatchFilter{
		Statuses:    statuses,
		Search:      search,
		PageRequest: req.toPageRequest(),
	})
	if err != nil {
		return PageResult{}, err
	}
	items := make([]InventoryBatchDTO, 0, len(page.Items))
	for _, b := range page.Items {
		dto, err := batchDTO(a, b)
		if err != nil {
			return PageResult{}, err
		}
		items = append(items, dto)
	}
	return PageResult{Items: items, Total: page.Total, Page: req.Page, PageSize: req.PageSize}, nil
}

// ListInventoryMovements returns the kardex ledger.
func (a *App) ListInventoryMovements(req PaginationRequest, productID string) (PageResult, error) {
	pid, err := parseOptionalUUID(productID)
	if err != nil {
		return PageResult{}, err
	}
	page, err := a.inventorySvc.ListMovements(a.Context(), inventory.InventoryMovementFilter{
		ProductID:   pid,
		PageRequest: req.toPageRequest(),
	})
	if err != nil {
		return PageResult{}, err
	}
	items := make([]InventoryMovementDTO, 0, len(page.Items))
	for _, m := range page.Items {
		items = append(items, InventoryMovementDTO{
			ID:           m.ID.String(),
			BatchID:      m.BatchID.String(),
			ProductID:    m.ProductID.String(),
			MovementDate: m.MovementDate.Format(time.RFC3339),
			Type:         string(m.Type),
			Quantity:     m.QuantityDelta.Decimal().InexactFloat64(),
			BalanceAfter: m.BalanceAfter.Decimal().InexactFloat64(),
			UnitCost:     m.UnitCost.Decimal().InexactFloat64(),
			Notes:        m.Notes,
		})
	}
	return PageResult{Items: items, Total: page.Total, Page: req.Page, PageSize: req.PageSize}, nil
}

type ReceiveStockRequest struct {
	ProductID   string  `json:"productId"`
	Quantity    float64 `json:"quantity"`
	ArrivalDate string  `json:"arrivalDate"`
	UnitCost    float64 `json:"unitCost"`
}

// ReceiveStock registers a manual goods intake ("Almacén Principal" is
// implicit). The arrival date cannot be in the future.
func (a *App) ReceiveStock(req ReceiveStockRequest) (InventoryBatchDTO, error) {
	pid, err := parseUUID(req.ProductID)
	if err != nil {
		return InventoryBatchDTO{}, err
	}
	arrival, err := parseDate(req.ArrivalDate)
	if err != nil {
		return InventoryBatchDTO{}, err
	}
	qty, err := quantityFromFloat(req.Quantity)
	if err != nil {
		return InventoryBatchDTO{}, err
	}
	unitCost, err := moneyFromFloat(req.UnitCost)
	if err != nil {
		return InventoryBatchDTO{}, err
	}
	batch, err := a.inventorySvc.Receive(a.Context(), inventory.ReceiveInput{
		ProductID:   pid,
		Quantity:    qty,
		ArrivalDate: arrival,
		UnitCost:    unitCost,
	})
	if err != nil {
		return InventoryBatchDTO{}, err
	}
	return batchDTO(a, batch)
}

type AdjustStockRequest struct {
	BatchID     string  `json:"batchId"`
	NewQuantity float64 `json:"newQuantity"`
	Notes       string  `json:"notes"`
}

// AdjustStock sets the batch quantity to an absolute positive target.
func (a *App) AdjustStock(req AdjustStockRequest) error {
	bid, err := parseUUID(req.BatchID)
	if err != nil {
		return err
	}
	qty, err := quantityFromFloat(req.NewQuantity)
	if err != nil {
		return err
	}
	return a.inventorySvc.Adjust(a.Context(), inventory.AdjustInput{BatchID: bid, NewQuantity: qty, Notes: req.Notes})
}

type VoidStockRequest struct {
	BatchID string `json:"batchId"`
	Reason  string `json:"reason"`
}

// VoidStock zeroes the remaining stock of a batch (write-off).
func (a *App) VoidStock(req VoidStockRequest) error {
	bid, err := parseUUID(req.BatchID)
	if err != nil {
		return err
	}
	return a.inventorySvc.Void(a.Context(), inventory.VoidInput{BatchID: bid, Reason: req.Reason})
}
