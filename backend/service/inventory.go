package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type InventoryService struct{ core *Core }
type ManualLot struct {
	ID            int64  `json:"id"`
	Code          string `json:"code"`
	ProductID     int64  `json:"productId"`
	SupplierID    *int64 `json:"supplierId"`
	Qty           int64  `json:"qty"`
	UnitCostCents int64  `json:"unitCostCents"`
	Currency      string `json:"currency"`
	TC            int64  `json:"tc"`
	EntryDate     string `json:"entryDate"`
	CountdownDays *int   `json:"countdownDays"`
}
type SuggestedLot struct {
	LotID            int64  `json:"lotId"`
	Code             string `json:"code"`
	Available        int64  `json:"available"`
	SuggestedQty     int64  `json:"suggestedQty"`
	UnitCostCents    int64  `json:"unitCostCents"`
	Currency         string `json:"currency"`
	TC               int64  `json:"tc"`
	ReservedClientID *int64 `json:"reservedClientId"`
}

func (s *InventoryService) SaveManualLot(v ManualLot) (ManualLot, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if v.ProductID <= 0 || v.Qty <= 0 || v.UnitCostCents < 0 {
		return v, fmt.Errorf("productId, positive qty and non-negative unitCostCents are required")
	}
	if errs := validateMoney("unitCostCents", v.UnitCostCents, v.Currency, v.TC); len(errs) > 0 {
		return v, validation(errs)
	}
	if v.EntryDate == "" {
		v.EntryDate = today()
	}
	if e = validateDate("entryDate", v.EntryDate); e != nil {
		return v, e
	}
	if v.Code == "" {
		v.Code, e = nextCode(context.Background(), db, "lot")
		if e != nil {
			return v, e
		}
	}
	t := now()
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO lots(code,product_id,source,supplier_id,qty_initial,unit_cost_cents,currency,tc,entry_date,countdown_days,countdown_start,created_at,updated_at) VALUES(?,?,'manual',?,?,?,?,?,?,?,?,?,?)`, v.Code, v.ProductID, v.SupplierID, v.Qty, v.UnitCostCents, v.Currency, v.TC, v.EntryDate, v.CountdownDays, v.EntryDate, t, t)
		if e != nil {
			return v, constraintError("code", e)
		}
		v.ID, _ = r.LastInsertId()
	} else {
		var sold int64
		if e = db.QueryRow(`SELECT COALESCE(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.lot_id=? AND s.voided_at IS NULL`, v.ID).Scan(&sold); e != nil {
			return v, e
		}
		if v.Qty < sold {
			return v, fmt.Errorf("qty: cannot reduce below sold units")
		}
		if sold > 0 {
			var product, cost, rate int64
			var currency string
			if e = db.QueryRow(`SELECT product_id,unit_cost_cents,currency,tc FROM lots WHERE id=? AND source='manual'`, v.ID).Scan(&product, &cost, &currency, &rate); e != nil {
				return v, e
			}
			if product != v.ProductID {
				return v, fmt.Errorf("productId: cannot change the product after sale")
			}
			if cost != v.UnitCostCents || currency != v.Currency || rate != v.TC {
				return v, fmt.Errorf("unitCostCents: cost fields cannot change after sale")
			}
		}
		_, e = db.Exec(`UPDATE lots SET code=?,product_id=?,supplier_id=?,qty_initial=?,unit_cost_cents=?,currency=?,tc=?,entry_date=?,countdown_days=?,updated_at=? WHERE id=? AND source='manual'`, v.Code, v.ProductID, v.SupplierID, v.Qty, v.UnitCostCents, v.Currency, v.TC, v.EntryDate, v.CountdownDays, t, v.ID)
		if e != nil {
			return v, constraintError("code", e)
		}
	}
	if e = bumpCodeDB(context.Background(), db, v.Code); e != nil {
		return v, e
	}
	return v, nil
}
func (s *InventoryService) NextCode() (string, error) { return s.core.CatalogNextCode("lot") }
func (s *InventoryService) List(q ListQuery) (Page, error) {
	return s.core.list("lots", "entry_date", q)
}
func (s *InventoryService) LotsForProduct(productID int64) ([]map[string]any, error) {
	return s.core.rows(`SELECT l.*,ls.available FROM lot_stock ls JOIN lots l ON l.id=ls.id WHERE l.product_id=? ORDER BY l.entry_date,l.id`, productID)
}
func (s *InventoryService) Kardex(productID int64) ([]map[string]any, error) {
	return s.core.rows(`SELECT date,code,direction,qty,balance,ref_id FROM kardex WHERE product_id=? ORDER BY date DESC,ref_id DESC`, productID)
}
func (s *InventoryService) ListKardex(productID int64, q ListQuery) (Page, error) {
	db, e := s.core.check()
	if e != nil {
		return Page{}, e
	}
	columns := map[string]string{"date": "date", "movement": "direction", "qty": "qty"}
	where := []string{"product_id=?"}
	args := []any{productID}
	for _, f := range q.Filters {
		col, ok := columns[f.Field]
		if !ok {
			return Page{}, fmt.Errorf("unsupported kardex filter field %q", f.Field)
		}
		clause, values, err := makeFilter(col, f)
		if err != nil {
			return Page{}, err
		}
		where = append(where, clause)
		args = append(args, values...)
	}
	if q.CursorMonth != "" {
		where = append(where, "substr(date,1,7)<?")
		args = append(args, q.CursorMonth)
	}
	rows, err := rowsDB(db, `SELECT *,substr(date,1,7) AS _month FROM kardex WHERE `+strings.Join(where, " AND ")+` ORDER BY date DESC,ref_id DESC`, args...)
	if err != nil {
		return Page{}, err
	}
	limit := q.MonthsLimit
	if limit <= 0 {
		limit = 6
	}
	if limit > 120 {
		limit = 120
	}
	groups := []MonthGroup{}
	index := map[string]int{}
	for _, row := range rows {
		month, _ := row["_month"].(string)
		i, ok := index[month]
		if !ok {
			if len(groups) >= limit {
				continue
			}
			i = len(groups)
			index[month] = i
			groups = append(groups, MonthGroup{Month: month, Rows: []map[string]any{}})
		}
		delete(row, "_month")
		groups[i].Rows = append(groups[i].Rows, row)
		groups[i].Count++
		if n, ok := numeric(row["qty"]); ok {
			groups[i].Total += n
		}
	}
	page := Page{Months: groups}
	if len(groups) > 0 {
		page.NextCursor = groups[len(groups)-1].Month
	}
	return page, nil
}
func (s *InventoryService) GetFilterSchema() []map[string]any { return filterSchema("kardex") }
func (s *InventoryService) SuggestLots(productID, qty int64) ([]SuggestedLot, error) {
	return s.suggest(productID, qty, nil)
}
func (s *InventoryService) suggest(productID, qty int64, clientID *int64) ([]SuggestedLot, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	if qty <= 0 {
		return nil, fmt.Errorf("qty must be positive")
	}
	rows, e := db.Query(`SELECT l.id,l.code,ls.available,l.unit_cost_cents,l.currency,l.tc,l.reserved_client_id FROM lot_stock ls JOIN lots l ON l.id=ls.id WHERE l.product_id=? AND ls.available>0 ORDER BY l.entry_date,l.id`, productID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []SuggestedLot{}
	remaining := qty
	for rows.Next() {
		var v SuggestedLot
		var reserved sql.NullInt64
		if e = rows.Scan(&v.LotID, &v.Code, &v.Available, &v.UnitCostCents, &v.Currency, &v.TC, &reserved); e != nil {
			return nil, e
		}
		if reserved.Valid {
			if clientID == nil || reserved.Int64 != *clientID {
				continue
			}
			v.ReservedClientID = &reserved.Int64
		}
		take := v.Available
		if take > remaining {
			take = remaining
		}
		v.SuggestedQty = take
		out = append(out, v)
		remaining -= take
		if remaining == 0 {
			break
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if remaining > 0 {
		return nil, fmt.Errorf("stock: insufficient available inventory; short by %d", remaining)
	}
	return out, nil
}
func (s *InventoryService) RestartCountdown(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	r, e := db.Exec(`UPDATE lots SET countdown_start=?,updated_at=? WHERE id=? AND voided_at IS NULL`, today(), now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
func (s *InventoryService) DismissAuction(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	r, e := db.Exec(`UPDATE lots SET countdown_days=0,updated_at=? WHERE id=? AND voided_at IS NULL`, now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
func (s *InventoryService) Void(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	var sold int64
	if e = db.QueryRow(`SELECT COALESCE(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.lot_id=? AND s.voided_at IS NULL`, id).Scan(&sold); e != nil {
		return e
	}
	if sold > 0 {
		return fmt.Errorf("lot: cannot void a lot with sold units")
	}
	return s.core.void("lots", id, true)
}
func (s *InventoryService) Restore(id int64) error { return s.core.void("lots", id, false) }
