package bindings

import (
	"vfinancy/backend/internal/features/supplier"
)

type SupplierDTO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ContactName string `json:"contactName"`
	Phone       string `json:"phone"`
	Email       string `json:"email"`
	Address     string `json:"address"`
	IsActive    bool   `json:"isActive"`
}

func supplierDTO(s *supplier.Supplier) SupplierDTO {
	return SupplierDTO{
		ID:          s.ID.String(),
		Name:        s.Name,
		ContactName: s.ContactName,
		Phone:       s.Phone,
		Email:       s.Email,
		Address:     s.Address,
		IsActive:    s.IsActive,
	}
}

// ListSuppliers returns the supplier portfolio.
func (a *App) ListSuppliers(req PaginationRequest, search string) (PageResult, error) {
	page, err := a.suppliersSvc.List(a.Context(), supplier.SupplierFilter{Search: search, PageRequest: req.toPageRequest()})
	if err != nil {
		return PageResult{}, err
	}
	items := make([]SupplierDTO, 0, len(page.Items))
	for _, s := range page.Items {
		items = append(items, supplierDTO(s))
	}
	return PageResult{Items: items, Total: page.Total, Page: req.Page, PageSize: req.PageSize}, nil
}

// SupplierOptions returns active suppliers for the purchase form
// select.
func (a *App) SupplierOptions() ([]SupplierDTO, error) {
	list, err := a.suppliersSvc.Options(a.Context())
	if err != nil {
		return nil, err
	}
	items := make([]SupplierDTO, 0, len(list))
	for _, s := range list {
		items = append(items, supplierDTO(s))
	}
	return items, nil
}

type SaveSupplierRequest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ContactName string `json:"contactName"`
	Phone       string `json:"phone"`
	Email       string `json:"email"`
	Address     string `json:"address"`
	Status      string `json:"status"`
}

// CreateSupplier registers a vendor.
func (a *App) CreateSupplier(req SaveSupplierRequest) (SupplierDTO, error) {
	s, err := a.suppliersSvc.Create(a.Context(), supplier.CreateInput{
		Name:        req.Name,
		ContactName: req.ContactName,
		Phone:       req.Phone,
		Email:       req.Email,
		Address:     req.Address,
	})
	if err != nil {
		return SupplierDTO{}, err
	}
	return supplierDTO(s), nil
}

// UpdateSupplier edits the vendor data.
func (a *App) UpdateSupplier(req SaveSupplierRequest) (SupplierDTO, error) {
	id, err := parseUUID(req.ID)
	if err != nil {
		return SupplierDTO{}, err
	}
	s, err := a.suppliersSvc.Update(a.Context(), supplier.UpdateInput{
		ID:          id,
		Name:        req.Name,
		ContactName: req.ContactName,
		Phone:       req.Phone,
		Email:       req.Email,
		Address:     req.Address,
		Status:      req.Status,
	})
	if err != nil {
		return SupplierDTO{}, err
	}
	return supplierDTO(s), nil
}

// RemoveSupplier soft-deletes the vendor.
func (a *App) RemoveSupplier(id string) error {
	sid, err := parseUUID(id)
	if err != nil {
		return err
	}
	return a.suppliersSvc.Delete(a.Context(), sid)
}