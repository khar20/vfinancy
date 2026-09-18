package bindings

import (
	"vfinancy/backend/internal/features/product"
)

type ProductDTO struct {
	ID          string  `json:"id"`
	SKU         string  `json:"sku"`
	Description string  `json:"description"`
	UnitCode    string  `json:"unitCode"`
	CostUSD     float64 `json:"costUsd"`
	SalePrice   float64 `json:"salePrice"`
	IsActive    bool    `json:"isActive"`
}

func productDTO(p *product.Product) ProductDTO {
	return ProductDTO{
		ID:          p.ID.String(),
		SKU:         p.SKU.String(),
		Description: p.Description,
		UnitCode:    p.UnitCode,
		CostUSD:     moneyFloat(p.CostUSD),
		SalePrice:   moneyFloat(p.SalePrice),
		IsActive:    p.IsActive,
	}
}

// ListProducts returns the catalog created through purchase orders.
func (a *App) ListProducts(req PaginationRequest, search string) (PageResult, error) {
	page, err := a.productsSvc.List(a.Context(), product.ProductFilter{Search: search, PageRequest: req.toPageRequest()})
	if err != nil {
		return PageResult{}, err
	}
	items := make([]ProductDTO, 0, len(page.Items))
	for _, p := range page.Items {
		items = append(items, productDTO(p))
	}
	return PageResult{Items: items, Total: page.Total, Page: req.Page, PageSize: req.PageSize}, nil
}

// ProductOptions returns the active catalog for selects.
func (a *App) ProductOptions() ([]ProductDTO, error) {
	products, err := a.productsSvc.Options(a.Context())
	if err != nil {
		return nil, err
	}
	items := make([]ProductDTO, 0, len(products))
	for _, p := range products {
		items = append(items, productDTO(p))
	}
	return items, nil
}

// GetProduct returns one catalog item.
func (a *App) GetProduct(id string) (ProductDTO, error) {
	pid, err := parseUUID(id)
	if err != nil {
		return ProductDTO{}, err
	}
	p, err := a.productsSvc.GetByID(a.Context(), pid)
	if err != nil {
		return ProductDTO{}, err
	}
	return productDTO(p), nil
}

type SaveProductRequest struct {
	ID          string  `json:"id"`
	SKU         string  `json:"sku"`
	Description string  `json:"description"`
	UnitCode    string  `json:"unitCode"`
	CostUSD     float64 `json:"costUsd"`
	SalePrice   float64 `json:"salePrice"`
}

// CreateProduct registers a catalog item (the reception of a purchase
// also creates items implicitly by description). The SKU is optional:
// an empty value keeps the generated one, and it is immutable after
// the row is inserted.
func (a *App) CreateProduct(req SaveProductRequest) (ProductDTO, error) {
	cost, err := moneyFromFloat(req.CostUSD)
	if err != nil {
		return ProductDTO{}, err
	}
	price, err := moneyFromFloat(req.SalePrice)
	if err != nil {
		return ProductDTO{}, err
	}
	p, err := a.productsSvc.Create(a.Context(), product.CreateInput{Description: req.Description, UnitCode: req.UnitCode, SKU: req.SKU, CostUSD: cost, SalePrice: price})
	if err != nil {
		return ProductDTO{}, err
	}
	return productDTO(p), nil
}

// UpdateProduct edits SKU, description and/or prices (empty/nil = keep).
func (a *App) UpdateProduct(req SaveProductRequest) (ProductDTO, error) {
	pid, err := parseUUID(req.ID)
	if err != nil {
		return ProductDTO{}, err
	}
	cost, err := moneyPtrFromFloat(req.CostUSD)
	if err != nil {
		return ProductDTO{}, err
	}
	price, err := moneyPtrFromFloat(req.SalePrice)
	if err != nil {
		return ProductDTO{}, err
	}
	p, err := a.productsSvc.Update(a.Context(), product.UpdateInput{ID: pid, SKU: req.SKU, Description: req.Description, UnitCode: &req.UnitCode, CostUSD: cost, SalePrice: price})
	if err != nil {
		return ProductDTO{}, err
	}
	return productDTO(p), nil
}

// SetProductActive toggles catalog visibility without deleting the
// product, preserving historical references.
func (a *App) SetProductActive(id string, active bool) error {
	pid, err := parseUUID(id)
	if err != nil {
		return err
	}
	if active {
		return a.productsSvc.Activate(a.Context(), pid)
	}
	return a.productsSvc.Deactivate(a.Context(), pid)
}

// RemoveProduct soft-deletes a catalog item.
func (a *App) RemoveProduct(id string) error {
	pid, err := parseUUID(id)
	if err != nil {
		return err
	}
	return a.productsSvc.Delete(a.Context(), pid)
}

// GetProductStock returns the total available quantity of a product in
// the main warehouse (edge case 4.3: block stock sales without stock).
func (a *App) GetProductStock(id string) (float64, error) {
	pid, err := parseUUID(id)
	if err != nil {
		return 0, err
	}
	q, err := a.inventorySvc.StockForProduct(a.Context(), pid)
	if err != nil {
		return 0, err
	}
	return quantityFloat(q), nil
}
