package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"a/backend/codes"
	"a/backend/money"
)

type PurchaseService struct{ core *Core }
type PurchaseItem struct {
	ID            int64  `json:"id"`
	ProductID     int64  `json:"productId"`
	Description   string `json:"description"`
	Qty           int64  `json:"qty"`
	UnitCostCents int64  `json:"unitCostCents"`
}
type Extra struct {
	ID          int64  `json:"id"`
	Concept     string `json:"concept"`
	AmountCents int64  `json:"amountCents"`
	Currency    string `json:"currency"`
}
type Purchase struct {
	ID            int64          `json:"id"`
	Code          string         `json:"code"`
	SupplierID    int64          `json:"supplierId"`
	Date          string         `json:"date"`
	PaymentMethod string         `json:"paymentMethod"`
	CardID        *int64         `json:"cardId"`
	Currency      string         `json:"currency"`
	TC            int64          `json:"tc"`
	ForClientID   *int64         `json:"forClientId"`
	Status        string         `json:"status"`
	ReceivedAt    string         `json:"receivedAt,omitempty"`
	Items         []PurchaseItem `json:"items"`
	Extras        []Extra        `json:"extras"`
}
type DocumentTotals struct {
	SubtotalCents         int64  `json:"subtotalCents"`
	ExtrasCents           int64  `json:"extrasCents"`
	TotalCents            int64  `json:"totalCents"`
	OriginalSubtotalCents int64  `json:"originalSubtotalCents"`
	OriginalExtrasCents   int64  `json:"originalExtrasCents"`
	OriginalTotalCents    int64  `json:"originalTotalCents"`
	Currency              string `json:"currency"`
	DocumentCurrency      string `json:"documentCurrency"`
}

func (s *PurchaseService) NextCode() (string, error) { return s.core.CatalogNextCode("purchase") }
func (s *PurchaseService) PreviewTotal(v Purchase, displayCurrency string) (DocumentTotals, error) {
	if _, e := s.core.check(); e != nil {
		return DocumentTotals{}, e
	}
	if errs := validateMoney("total", 0, v.Currency, v.TC); len(errs) > 0 {
		return DocumentTotals{}, validation(errs)
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		return DocumentTotals{}, fmt.Errorf("displayCurrency must be PEN or USD")
	}
	var subtotal, originalExtras, displayExtras int64
	for i, item := range v.Items {
		amount, e := multiplyMoney(item.Qty, item.UnitCostCents)
		if e != nil {
			return DocumentTotals{}, fmt.Errorf("items[%d]: %w", i, e)
		}
		subtotal, e = sumMoney(subtotal, amount)
		if e != nil {
			return DocumentTotals{}, e
		}
	}
	for i, extra := range v.Extras {
		if !money.Currency(extra.Currency).Valid() || extra.AmountCents < 0 || extra.AmountCents > int64(money.Max) {
			return DocumentTotals{}, fmt.Errorf("extras[%d]: invalid amount or currency", i)
		}
		amount, e := money.Convert(money.Money(extra.AmountCents), money.Currency(extra.Currency), money.Currency(v.Currency), v.TC)
		if e != nil {
			return DocumentTotals{}, e
		}
		originalExtras, e = sumMoney(originalExtras, int64(amount))
		if e != nil {
			return DocumentTotals{}, e
		}
		shown, e := money.Convert(amount, money.Currency(v.Currency), money.Currency(displayCurrency), v.TC)
		if e != nil {
			return DocumentTotals{}, e
		}
		displayExtras, e = sumMoney(displayExtras, int64(shown))
		if e != nil {
			return DocumentTotals{}, e
		}
	}
	convert := func(value int64) (int64, error) {
		amount, e := money.Convert(money.Money(value), money.Currency(v.Currency), money.Currency(displayCurrency), v.TC)
		return int64(amount), e
	}
	docSubtotal, err := convert(subtotal)
	if err != nil {
		return DocumentTotals{}, err
	}
	originalTotal, err := sumMoney(subtotal, originalExtras)
	if err != nil {
		return DocumentTotals{}, err
	}
	total, err := sumMoney(docSubtotal, displayExtras)
	if err != nil {
		return DocumentTotals{}, err
	}
	return DocumentTotals{SubtotalCents: docSubtotal, ExtrasCents: displayExtras, TotalCents: total, OriginalSubtotalCents: subtotal, OriginalExtrasCents: originalExtras, OriginalTotalCents: originalTotal, Currency: displayCurrency, DocumentCurrency: v.Currency}, nil
}
func (s *PurchaseService) Save(v Purchase) (Purchase, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	errs := validateMoney("total", 0, v.Currency, v.TC)
	if v.SupplierID <= 0 {
		errs = append(errs, FieldError{"supplierId", "Supplier is required"})
	}
	if v.Date == "" {
		errs = append(errs, FieldError{"date", "Date is required"})
	} else if e = validateDate("date", v.Date); e != nil {
		return v, e
	}
	if v.PaymentMethod != "card" && v.PaymentMethod != "cash" && v.PaymentMethod != "wallet" {
		errs = append(errs, FieldError{"paymentMethod", "Choose card, cash, or wallet"})
	}
	if v.PaymentMethod == "card" && (v.CardID == nil || *v.CardID <= 0) {
		errs = append(errs, FieldError{"cardId", "Card is required"})
	}
	if len(errs) > 0 {
		return v, validation(errs)
	}
	if v.Code == "" {
		v.Code, e = nextCode(context.Background(), db, "purchase")
		if e != nil {
			return v, e
		}
	}
	tx, e := db.Begin()
	if e != nil {
		return v, e
	}
	defer tx.Rollback()
	t := now()
	received := false
	preserveItems := false
	if v.ID == 0 {
		r, e := tx.Exec(`INSERT INTO purchases(code,supplier_id,date,payment_method,card_id,currency,tc,for_client_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, v.Code, v.SupplierID, v.Date, v.PaymentMethod, v.CardID, v.Currency, v.TC, v.ForClientID, t, t)
		if e != nil {
			return v, constraintError("code", e)
		}
		v.ID, _ = r.LastInsertId()
	} else {
		var status string
		if e = tx.QueryRow(`SELECT status FROM purchases WHERE id=? AND voided_at IS NULL`, v.ID).Scan(&status); e != nil {
			return v, e
		}
		received = status == "received"
		_, e = tx.Exec(`UPDATE purchases SET code=?,supplier_id=?,date=?,payment_method=?,card_id=?,currency=?,tc=?,for_client_id=?,updated_at=? WHERE id=?`, v.Code, v.SupplierID, v.Date, v.PaymentMethod, v.CardID, v.Currency, v.TC, v.ForClientID, t, v.ID)
		if e != nil {
			return v, constraintError("code", e)
		}
		if received {
			rows, err := tx.Query(`SELECT pi.product_id,pi.description,pi.qty,pi.unit_cost_cents,COALESCE(SUM(CASE WHEN s.voided_at IS NULL THEN si.qty ELSE 0 END),0) FROM purchase_items pi LEFT JOIN lots l ON l.purchase_item_id=pi.id LEFT JOIN sale_items si ON si.lot_id=l.id LEFT JOIN sales s ON s.id=si.sale_id WHERE pi.purchase_id=? GROUP BY pi.id ORDER BY pi.id`, v.ID)
			if err != nil {
				return v, err
			}
			type savedItem struct {
				product, qty, cost, sold int64
				description              string
			}
			saved := []savedItem{}
			for rows.Next() {
				var item savedItem
				if err = rows.Scan(&item.product, &item.description, &item.qty, &item.cost, &item.sold); err != nil {
					rows.Close()
					return v, err
				}
				saved = append(saved, item)
			}
			if err = rows.Close(); err != nil {
				return v, err
			}
			preserveItems = len(saved) == len(v.Items)
			for i, it := range v.Items {
				if i >= len(saved) || saved[i].product != it.ProductID || saved[i].description != it.Description || saved[i].qty != it.Qty || saved[i].cost != it.UnitCostCents {
					preserveItems = false
				}
			}
			if !preserveItems {
				for _, item := range saved {
					if item.sold > 0 {
						return v, fmt.Errorf("items: received purchase lines with sales cannot be changed")
					}
				}
				if _, err = tx.Exec(`DELETE FROM lots WHERE purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id=?)`, v.ID); err != nil {
					return v, err
				}
			}
		}
		if !preserveItems {
			_, e = tx.Exec(`DELETE FROM purchase_items WHERE purchase_id=?`, v.ID)
			if e != nil {
				return v, e
			}
		}
		_, e = tx.Exec(`DELETE FROM purchase_extras WHERE purchase_id=?`, v.ID)
		if e != nil {
			return v, e
		}
	}
	for i, it := range v.Items {
		if it.ProductID <= 0 || it.Qty <= 0 || it.UnitCostCents < 0 || it.UnitCostCents > int64(money.Max) {
			return v, fmt.Errorf("items[%d]: invalid product, quantity or cost", i)
		}
		if preserveItems {
			if e = tx.QueryRow(`SELECT id FROM purchase_items WHERE purchase_id=? ORDER BY id LIMIT 1 OFFSET ?`, v.ID, i).Scan(&it.ID); e != nil {
				return v, e
			}
			var reserved any
			if v.ForClientID != nil {
				reserved = *v.ForClientID
			}
			if _, e = tx.Exec(`UPDATE lots SET code=?,supplier_id=?,currency=?,tc=?,entry_date=?,countdown_start=?,reserved_client_id=?,updated_at=? WHERE purchase_item_id=?`, fmt.Sprintf("%s-%d", v.Code, i+1), v.SupplierID, v.Currency, v.TC, v.Date, v.Date, reserved, t, it.ID); e != nil {
				return v, e
			}
		} else {
			r, err := tx.Exec(`INSERT INTO purchase_items(purchase_id,product_id,description,qty,unit_cost_cents) VALUES(?,?,?,?,?)`, v.ID, it.ProductID, it.Description, it.Qty, it.UnitCostCents)
			if err != nil {
				return v, err
			}
			it.ID, _ = r.LastInsertId()
			if received {
				var reserved any
				if v.ForClientID != nil {
					reserved = *v.ForClientID
				}
				_, err = tx.Exec(`INSERT INTO lots(code,product_id,purchase_item_id,source,supplier_id,qty_initial,unit_cost_cents,currency,tc,entry_date,countdown_start,reserved_client_id,created_at,updated_at) VALUES(?,?,?,'purchase',?,?,?,?,?,?,?,?,?,?)`, fmt.Sprintf("%s-%d", v.Code, i+1), it.ProductID, it.ID, v.SupplierID, it.Qty, it.UnitCostCents, v.Currency, v.TC, v.Date, v.Date, reserved, t, t)
				if err != nil {
					return v, err
				}
			}
		}
		v.Items[i] = it
		if received {
			if _, e = tx.Exec(`UPDATE products SET default_cost_cents=?,default_cost_currency=?,default_cost_tc=?,updated_at=? WHERE id=?`, it.UnitCostCents, v.Currency, v.TC, t, it.ProductID); e != nil {
				return v, e
			}
			if _, e = tx.Exec(`INSERT OR IGNORE INTO product_suppliers(product_id,supplier_id) VALUES(?,?)`, it.ProductID, v.SupplierID); e != nil {
				return v, e
			}
		}
	}
	for i, x := range v.Extras {
		if x.Currency != "PEN" && x.Currency != "USD" || x.AmountCents < 0 || x.AmountCents > int64(money.Max) || strings.TrimSpace(x.Concept) == "" {
			return v, fmt.Errorf("extras[%d]: invalid concept, amount, or currency", i)
		}
		r, e := tx.Exec(`INSERT INTO purchase_extras(purchase_id,concept,amount_cents,currency) VALUES(?,?,?,?)`, v.ID, x.Concept, x.AmountCents, x.Currency)
		if e != nil {
			return v, e
		}
		x.ID, _ = r.LastInsertId()
		v.Extras[i] = x
	}
	if e = codes.Bump(context.Background(), tx, v.Code); e != nil {
		return v, e
	}
	if _, e = tx.Exec(`INSERT INTO settings(key,value) VALUES('last_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, v.PaymentMethod); e != nil {
		return v, e
	}
	return v, tx.Commit()
}
func (s *PurchaseService) ReceivePurchase(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var code, currency, date string
	var supplier int64
	var rate int64
	var client sql.NullInt64
	var status string
	e = tx.QueryRow(`SELECT code,supplier_id,date,currency,tc,for_client_id,status FROM purchases WHERE id=? AND voided_at IS NULL`, id).Scan(&code, &supplier, &date, &currency, &rate, &client, &status)
	if e != nil {
		return e
	}
	if status == "received" {
		return fmt.Errorf("purchase is already received")
	}
	rows, e := tx.Query(`SELECT id,product_id,qty,unit_cost_cents FROM purchase_items WHERE purchase_id=? ORDER BY id`, id)
	if e != nil {
		return e
	}
	type item struct{ id, product, qty, cost int64 }
	items := []item{}
	for rows.Next() {
		var x item
		if e = rows.Scan(&x.id, &x.product, &x.qty, &x.cost); e != nil {
			rows.Close()
			return e
		}
		items = append(items, x)
	}
	rows.Close()
	if len(items) == 0 {
		return fmt.Errorf("items: at least one item is required")
	}
	start := now()
	for i, it := range items {
		lotCode := fmt.Sprintf("%s-%d", code, i+1)
		var exists int
		if e = tx.QueryRow(`SELECT COUNT(*) FROM lots WHERE code=?`, lotCode).Scan(&exists); e != nil {
			return e
		}
		if exists > 0 {
			return fmt.Errorf("lots: generated lot code %s already exists", lotCode)
		}
		var reserved any
		if client.Valid {
			reserved = client.Int64
		}
		_, e = tx.Exec(`INSERT INTO lots(code,product_id,purchase_item_id,source,supplier_id,qty_initial,unit_cost_cents,currency,tc,entry_date,countdown_start,reserved_client_id,created_at,updated_at) VALUES(?,?,?,'purchase',?,?,?,?,?,?,?, ?,?,?)`, lotCode, it.product, it.id, supplier, it.qty, it.cost, currency, rate, date, date, reserved, start, start)
		if e != nil {
			return e
		}
		_, e = tx.Exec(`UPDATE products SET default_cost_cents=?,default_cost_currency=?,default_cost_tc=?,updated_at=? WHERE id=?`, it.cost, currency, rate, start, it.product)
		if e != nil {
			return e
		}
		_, e = tx.Exec(`INSERT OR IGNORE INTO product_suppliers(product_id,supplier_id) VALUES(?,?)`, it.product, supplier)
		if e != nil {
			return e
		}
	}
	_, e = tx.Exec(`UPDATE purchases SET status='received',received_at=?,updated_at=? WHERE id=?`, start, start, id)
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (s *PurchaseService) List(q ListQuery) (Page, error) { return s.core.list("purchases", "date", q) }
func (s *PurchaseService) Get(id int64) (Purchase, error) {
	db, e := s.core.check()
	if e != nil {
		return Purchase{}, e
	}
	var v Purchase
	var card, client sql.NullInt64
	var received sql.NullString
	if e = db.QueryRow(`SELECT id,code,supplier_id,date,payment_method,card_id,currency,tc,for_client_id,status,received_at FROM purchases WHERE id=?`, id).Scan(&v.ID, &v.Code, &v.SupplierID, &v.Date, &v.PaymentMethod, &card, &v.Currency, &v.TC, &client, &v.Status, &received); e != nil {
		return v, e
	}
	if card.Valid {
		v.CardID = &card.Int64
	}
	if client.Valid {
		v.ForClientID = &client.Int64
	}
	if received.Valid {
		v.ReceivedAt = received.String
	}
	items, e := db.Query(`SELECT id,product_id,description,qty,unit_cost_cents FROM purchase_items WHERE purchase_id=? ORDER BY id`, id)
	if e != nil {
		return v, e
	}
	for items.Next() {
		var item PurchaseItem
		if e = items.Scan(&item.ID, &item.ProductID, &item.Description, &item.Qty, &item.UnitCostCents); e != nil {
			items.Close()
			return v, e
		}
		v.Items = append(v.Items, item)
	}
	if e = items.Err(); e != nil {
		items.Close()
		return v, e
	}
	items.Close()
	extras, e := db.Query(`SELECT id,concept,amount_cents,currency FROM purchase_extras WHERE purchase_id=? ORDER BY id`, id)
	if e != nil {
		return v, e
	}
	for extras.Next() {
		var x Extra
		if e = extras.Scan(&x.ID, &x.Concept, &x.AmountCents, &x.Currency); e != nil {
			extras.Close()
			return v, e
		}
		v.Extras = append(v.Extras, x)
	}
	if e = extras.Err(); e != nil {
		extras.Close()
		return v, e
	}
	extras.Close()
	return v, nil
}
func (s *PurchaseService) Void(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var sold int
	if e = tx.QueryRow(`SELECT COUNT(*) FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN lots l ON l.id=si.lot_id JOIN purchase_items pi ON pi.id=l.purchase_item_id WHERE pi.purchase_id=? AND s.voided_at IS NULL`, id).Scan(&sold); e != nil {
		return e
	}
	if sold > 0 {
		return fmt.Errorf("purchase: void its sales first")
	}
	r, e := tx.Exec(`UPDATE purchases SET voided_at=?,updated_at=? WHERE id=? AND voided_at IS NULL`, now(), now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, e = tx.Exec(`UPDATE lots SET voided_at=?,updated_at=? WHERE purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id=?)`, now(), now(), id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *PurchaseService) Restore(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.Exec(`UPDATE purchases SET voided_at=NULL,updated_at=? WHERE id=? AND voided_at IS NOT NULL`, now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, e = tx.Exec(`UPDATE lots SET voided_at=NULL,updated_at=? WHERE purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id=?)`, now(), id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *PurchaseService) CancelOrder(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var sold int64
	if e = tx.QueryRow(`SELECT COALESCE(SUM(si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN lots l ON l.id=si.lot_id JOIN purchase_items pi ON pi.id=l.purchase_item_id WHERE pi.purchase_id=? AND s.voided_at IS NULL`, id).Scan(&sold); e != nil {
		return e
	}
	if sold > 0 {
		return fmt.Errorf("purchase: cannot cancel an order after sale")
	}
	r, e := tx.Exec(`UPDATE purchases SET for_client_id=NULL,updated_at=? WHERE id=? AND voided_at IS NULL`, now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, e = tx.Exec(`UPDATE lots SET reserved_client_id=NULL,updated_at=? WHERE purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id=?)`, now(), id); e != nil {
		return e
	}
	if _, e = tx.Exec(`UPDATE payments SET advance_status='refunded',updated_at=? WHERE purchase_id=? AND kind='advance' AND advance_status='active' AND voided_at IS NULL`, now(), id); e != nil {
		return e
	}
	return tx.Commit()
}
func (c *Core) CatalogNextCode(entity string) (string, error) {
	db, e := c.check()
	if e != nil {
		return "", e
	}
	return nextCode(context.Background(), db, entity)
}
