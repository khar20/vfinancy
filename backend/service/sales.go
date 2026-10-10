package service

import (
	"context"
	"database/sql"
	"fmt"

	"a/backend/codes"
	"a/backend/money"
)

type SalesService struct{ core *Core }
type SaleItem struct {
	ProductID      int64  `json:"productId"`
	LotID          int64  `json:"lotId"`
	Description    string `json:"description"`
	Qty            int64  `json:"qty"`
	UnitPriceCents int64  `json:"unitPriceCents"`
}
type Sale struct {
	ID             int64      `json:"id"`
	Code           string     `json:"code"`
	Kind           string     `json:"kind"`
	ClientID       *int64     `json:"clientId"`
	Date           string     `json:"date"`
	Currency       string     `json:"currency"`
	TC             int64      `json:"tc"`
	ShipmentStatus string     `json:"shipmentStatus,omitempty"`
	ShipRegion     string     `json:"shipRegion"`
	ShipAddress    string     `json:"shipAddress"`
	SecurityCode   string     `json:"securityCode"`
	Items          []SaleItem `json:"items"`
	Extras         []Extra    `json:"extras"`
	PaidNowCents   int64      `json:"paidNowCents"`
	PaymentMethod  string     `json:"paymentMethod"`
	PurchaseID     int64      `json:"purchaseId,omitempty"`
	Payments       []Payment  `json:"payments,omitempty"`
}
type SaleSummary struct {
	ID                   int64  `json:"id"`
	TotalCents           int64  `json:"totalCents"`
	PaidCents            int64  `json:"paidCents"`
	BalanceCents         int64  `json:"balanceCents"`
	Currency             string `json:"currency"`
	OriginalTotalCents   int64  `json:"originalTotalCents"`
	OriginalPaidCents    int64  `json:"originalPaidCents"`
	OriginalBalanceCents int64  `json:"originalBalanceCents"`
	DocumentCurrency     string `json:"documentCurrency"`
}

type SaleCosting struct {
	SaleID         int64  `json:"saleId"`
	SalesCents     int64  `json:"salesCents"`
	CostBaseCents  int64  `json:"costBaseCents"`
	CostExtraCents int64  `json:"costExtraCents"`
	ProfitCents    int64  `json:"profitCents"`
	Currency       string `json:"currency"`
}

func (s *SalesService) NextCode(kind string) (string, error) {
	if kind == "shipment" {
		return s.core.CatalogNextCode("shipment")
	}
	return s.core.CatalogNextCode("sale")
}
func (s *SalesService) PreviewTotal(v Sale, displayCurrency string) (DocumentTotals, error) {
	if _, e := s.core.check(); e != nil {
		return DocumentTotals{}, e
	}
	if v.Currency == "" {
		v.Currency = "PEN"
	}
	if v.TC == 0 {
		v.TC = 37500
	}
	if errs := validateMoney("total", 0, v.Currency, v.TC); len(errs) > 0 {
		return DocumentTotals{}, validation(errs)
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		return DocumentTotals{}, fmt.Errorf("displayCurrency must be PEN or USD")
	}
	var subtotal, originalExtras, displayExtras int64
	for i, item := range v.Items {
		amount, e := multiplyMoney(item.Qty, item.UnitPriceCents)
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
	displaySubtotal, e := convert(subtotal)
	if e != nil {
		return DocumentTotals{}, e
	}
	originalTotal, err := sumMoney(subtotal, originalExtras)
	if err != nil {
		return DocumentTotals{}, err
	}
	total, err := sumMoney(displaySubtotal, displayExtras)
	if err != nil {
		return DocumentTotals{}, err
	}
	return DocumentTotals{SubtotalCents: displaySubtotal, ExtrasCents: displayExtras, TotalCents: total, OriginalSubtotalCents: subtotal, OriginalExtrasCents: originalExtras, OriginalTotalCents: originalTotal, Currency: displayCurrency, DocumentCurrency: v.Currency}, nil
}
func (s *SalesService) Save(v Sale) (Sale, error) { return s.save(v, false) }
func (s *SalesService) save(v Sale, allowReserved bool) (Sale, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if v.Kind == "" {
		v.Kind = "sale"
	}
	if v.Kind != "sale" && v.Kind != "shipment" {
		return v, fmt.Errorf("kind: must be sale or shipment")
	}
	if v.Currency == "" {
		v.Currency = "PEN"
	}
	if v.TC == 0 {
		v.TC = 37500
	}
	if v.Date == "" {
		v.Date = today()
	}
	if e = validateDate("date", v.Date); e != nil {
		return v, e
	}
	if v.Kind == "shipment" && (v.ShipRegion == "" || v.ShipAddress == "") {
		return v, fmt.Errorf("shipRegion and shipAddress are required")
	}
	if len(v.Items) == 0 {
		return v, fmt.Errorf("items: at least one item is required")
	}
	if errs := validateMoney("total", 0, v.Currency, v.TC); len(errs) > 0 {
		return v, validation(errs)
	}
	if v.ID > 0 {
		var oldCode, oldSecurity string
		if e = db.QueryRow(`SELECT code,COALESCE(security_code,'') FROM sales WHERE id=? AND voided_at IS NULL`, v.ID).Scan(&oldCode, &oldSecurity); e != nil {
			return v, e
		}
		if v.Code == "" {
			v.Code = oldCode
		}
		if v.SecurityCode == "" {
			v.SecurityCode = oldSecurity
		}
	}
	if v.Code == "" {
		v.Code, e = nextCode(context.Background(), db, v.Kind)
		if e != nil {
			return v, e
		}
	}
	if v.Kind == "shipment" && v.SecurityCode == "" {
		v.SecurityCode, e = codes.SecurityCode()
		if e != nil {
			return v, e
		}
	}
	if v.Kind == "shipment" && (len(v.SecurityCode) != 4 || v.SecurityCode[0] < '0' || v.SecurityCode[0] > '9' || v.SecurityCode[1] < '0' || v.SecurityCode[1] > '9' || v.SecurityCode[2] < '0' || v.SecurityCode[2] > '9' || v.SecurityCode[3] < '0' || v.SecurityCode[3] > '9') {
		return v, fmt.Errorf("securityCode: must contain exactly four digits")
	}
	tx, e := db.Begin()
	if e != nil {
		return v, e
	}
	defer tx.Rollback()
	t := now()
	status := any(nil)
	if v.Kind == "shipment" {
		status = "prepared"
	}
	if v.ID == 0 {
		r, err := tx.Exec(`INSERT INTO sales(code,kind,client_id,date,currency,tc,shipment_status,security_code,ship_region,ship_address,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, v.Code, v.Kind, v.ClientID, v.Date, v.Currency, v.TC, status, v.SecurityCode, v.ShipRegion, v.ShipAddress, t, t)
		if err != nil {
			return v, constraintError("code", err)
		}
		v.ID, _ = r.LastInsertId()
	} else {
		var oldKind string
		var oldStatus sql.NullString
		if e = tx.QueryRow(`SELECT kind,shipment_status FROM sales WHERE id=? AND voided_at IS NULL`, v.ID).Scan(&oldKind, &oldStatus); e != nil {
			return v, e
		}
		if oldKind != v.Kind {
			return v, fmt.Errorf("kind: cannot change sale to shipment or shipment to sale")
		}
		if oldStatus.Valid {
			status = oldStatus.String
		}
		if _, e = tx.Exec(`UPDATE sales SET voided_at=?,code=?,client_id=?,date=?,currency=?,tc=?,shipment_status=?,security_code=?,ship_region=?,ship_address=?,updated_at=? WHERE id=?`, t, v.Code, v.ClientID, v.Date, v.Currency, v.TC, status, v.SecurityCode, v.ShipRegion, v.ShipAddress, t, v.ID); e != nil {
			return v, constraintError("code", e)
		}
		if _, e = tx.Exec(`DELETE FROM sale_items WHERE sale_id=?`, v.ID); e != nil {
			return v, e
		}
		if _, e = tx.Exec(`DELETE FROM sale_extras WHERE sale_id=?`, v.ID); e != nil {
			return v, e
		}
	}
	for i, it := range v.Items {
		if it.ProductID <= 0 || it.Qty <= 0 || it.UnitPriceCents < 0 || it.UnitPriceCents > int64(money.Max) {
			return v, fmt.Errorf("items[%d]: invalid product, quantity or price", i)
		}
		if it.LotID <= 0 {
			return v, fmt.Errorf("items[%d].lotId: a lot is required", i)
		}
		var available int64
		var product int64
		var reserved sql.NullInt64
		var purchase sql.NullInt64
		if e = tx.QueryRow(`SELECT ls.available,l.product_id,l.reserved_client_id,pi.purchase_id FROM lot_stock ls JOIN lots l ON l.id=ls.id LEFT JOIN purchase_items pi ON pi.id=l.purchase_item_id WHERE l.id=? AND l.voided_at IS NULL`, it.LotID).Scan(&available, &product, &reserved, &purchase); e != nil {
			return v, fmt.Errorf("items[%d].lotId: lot is unavailable", i)
		}
		if product != it.ProductID {
			return v, fmt.Errorf("items[%d].productId: does not match selected lot", i)
		}
		if it.Qty > available {
			return v, fmt.Errorf("items[%d].qty: exceeds available stock", i)
		}
		if reserved.Valid && (!allowReserved || v.ClientID == nil || *v.ClientID != reserved.Int64) {
			return v, fmt.Errorf("items[%d].lotId: lot is reserved for another client", i)
		}
		if allowReserved && (!reserved.Valid || v.ClientID == nil || reserved.Int64 != *v.ClientID || !purchase.Valid || purchase.Int64 != v.PurchaseID) {
			return v, fmt.Errorf("items[%d].lotId: lot is not reserved for this client order", i)
		}
		_, e = tx.Exec(`INSERT INTO sale_items(sale_id,product_id,lot_id,description,qty,unit_price_cents) VALUES(?,?,?,?,?,?)`, v.ID, it.ProductID, it.LotID, it.Description, it.Qty, it.UnitPriceCents)
		if e != nil {
			return v, e
		}
	}
	for i, x := range v.Extras {
		if x.Concept == "" || x.AmountCents < 0 || x.AmountCents > int64(money.Max) {
			return v, fmt.Errorf("extras[%d]: invalid concept or amount", i)
		}
		if !money.Currency(x.Currency).Valid() {
			return v, fmt.Errorf("extras[%d].currency: must be PEN or USD", i)
		}
		if _, e = tx.Exec(`INSERT INTO sale_extras(sale_id,concept,amount_cents,currency) VALUES(?,?,?,?)`, v.ID, x.Concept, x.AmountCents, x.Currency); e != nil {
			return v, e
		}
	}
	if e = codes.Bump(context.Background(), tx, v.Code); e != nil {
		return v, e
	}
	if v.PaidNowCents > 0 {
		if v.PaidNowCents > int64(money.Max) {
			return v, fmt.Errorf("paidNowCents: exceeds supported limit")
		}
		if v.PaymentMethod != "cash" && v.PaymentMethod != "card" && v.PaymentMethod != "wallet" {
			return v, fmt.Errorf("paymentMethod: choose cash, card, or wallet")
		}
		paymentCode, e := codes.NextTx(context.Background(), tx, "payment")
		if e != nil {
			return v, e
		}
		_, e = tx.Exec(`INSERT INTO payments(code,kind,client_id,sale_id,date,method,amount_cents,currency,tc,created_at,updated_at) VALUES(?,'payment',?,?,?,?,?,?,?, ?,?)`, paymentCode, v.ClientID, v.ID, v.Date, v.PaymentMethod, v.PaidNowCents, v.Currency, v.TC, t, t)
		if e != nil {
			return v, e
		}
		if e = codes.Bump(context.Background(), tx, paymentCode); e != nil {
			return v, e
		}
		if _, e = tx.Exec(`INSERT INTO settings(key,value) VALUES('last_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, v.PaymentMethod); e != nil {
			return v, e
		}
	}
	if allowReserved {
		if v.PurchaseID <= 0 {
			return v, fmt.Errorf("purchaseId: required for a client order")
		}
		var owner sql.NullInt64
		if e = tx.QueryRow(`SELECT for_client_id FROM purchases WHERE id=? AND voided_at IS NULL`, v.PurchaseID).Scan(&owner); e != nil {
			return v, e
		}
		if !owner.Valid || v.ClientID == nil || owner.Int64 != *v.ClientID {
			return v, fmt.Errorf("purchaseId: purchase is not reserved for this client")
		}
		if _, e = tx.Exec(`UPDATE payments SET sale_id=?,advance_status='applied',updated_at=? WHERE kind='advance' AND purchase_id=? AND client_id=? AND advance_status='active' AND voided_at IS NULL`, v.ID, t, v.PurchaseID, *v.ClientID); e != nil {
			return v, e
		}
	}
	if _, e = tx.Exec(`UPDATE sales SET voided_at=NULL,updated_at=? WHERE id=?`, t, v.ID); e != nil {
		return v, e
	}
	return v, tx.Commit()
}
func (s *SalesService) SellToClient(clientID, purchaseID int64, v Sale) (Sale, error) {
	if clientID <= 0 || purchaseID <= 0 {
		return v, fmt.Errorf("clientId and purchaseId are required")
	}
	v.ClientID = &clientID
	v.PurchaseID = purchaseID
	if len(v.Items) == 0 {
		return v, fmt.Errorf("items: at least one item is required")
	}
	expanded := make([]SaleItem, 0, len(v.Items))
	for i, item := range v.Items {
		if item.LotID > 0 {
			expanded = append(expanded, item)
			continue
		}
		suggested, e := s.suggestReservedPurchase(item.ProductID, item.Qty, purchaseID, clientID)
		if e != nil {
			return v, fmt.Errorf("items[%d]: %w", i, e)
		}
		for _, lot := range suggested {
			split := item
			split.LotID = lot.LotID
			split.Qty = lot.SuggestedQty
			expanded = append(expanded, split)
		}
	}
	v.Items = expanded
	return s.save(v, true)
}

func (s *SalesService) suggestReservedPurchase(productID, qty, purchaseID, clientID int64) ([]SuggestedLot, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	if qty <= 0 {
		return nil, fmt.Errorf("quantity must be positive")
	}
	rows, e := db.Query(`SELECT l.id,l.code,ls.available,l.unit_cost_cents,l.currency,l.tc,l.reserved_client_id FROM lot_stock ls JOIN lots l ON l.id=ls.id JOIN purchase_items pi ON pi.id=l.purchase_item_id WHERE pi.purchase_id=? AND l.product_id=? AND l.reserved_client_id=? AND ls.available>0 ORDER BY l.entry_date,l.id`, purchaseID, productID, clientID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []SuggestedLot{}
	remaining := qty
	for rows.Next() {
		var lot SuggestedLot
		var reserved sql.NullInt64
		if e = rows.Scan(&lot.LotID, &lot.Code, &lot.Available, &lot.UnitCostCents, &lot.Currency, &lot.TC, &reserved); e != nil {
			return nil, e
		}
		if reserved.Valid {
			lot.ReservedClientID = &reserved.Int64
		}
		lot.SuggestedQty = lot.Available
		if lot.SuggestedQty > remaining {
			lot.SuggestedQty = remaining
		}
		out = append(out, lot)
		remaining -= lot.SuggestedQty
		if remaining == 0 {
			break
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if remaining > 0 {
		return nil, fmt.Errorf("reserved stock is insufficient; short by %d", remaining)
	}
	return out, nil
}
func (s *SalesService) List(q ListQuery) (Page, error) { return s.core.list("sales", "date", q) }
func (s *SalesService) Get(id int64) (Sale, error) {
	db, e := s.core.check()
	if e != nil {
		return Sale{}, e
	}
	var v Sale
	var client sql.NullInt64
	var status, security, region, address sql.NullString
	if e = db.QueryRow(`SELECT id,code,kind,client_id,date,currency,tc,shipment_status,security_code,ship_region,ship_address FROM sales WHERE id=?`, id).Scan(&v.ID, &v.Code, &v.Kind, &client, &v.Date, &v.Currency, &v.TC, &status, &security, &region, &address); e != nil {
		return v, e
	}
	if client.Valid {
		v.ClientID = &client.Int64
	}
	v.ShipmentStatus = status.String
	v.SecurityCode = security.String
	v.ShipRegion = region.String
	v.ShipAddress = address.String
	items, e := db.Query(`SELECT product_id,lot_id,description,qty,unit_price_cents FROM sale_items WHERE sale_id=? ORDER BY id`, id)
	if e != nil {
		return v, e
	}
	for items.Next() {
		var item SaleItem
		if e = items.Scan(&item.ProductID, &item.LotID, &item.Description, &item.Qty, &item.UnitPriceCents); e != nil {
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
	extras, e := db.Query(`SELECT id,concept,amount_cents,currency FROM sale_extras WHERE sale_id=? ORDER BY id`, id)
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
	payments, e := db.Query(`SELECT id,code,kind,client_id,sale_id,purchase_id,date,method,amount_cents,currency,tc FROM payments WHERE sale_id=? AND voided_at IS NULL ORDER BY date,id`, id)
	if e != nil {
		return v, e
	}
	for payments.Next() {
		var p Payment
		var paymentClient, paymentSale, purchase sql.NullInt64
		if e = payments.Scan(&p.ID, &p.Code, &p.Kind, &paymentClient, &paymentSale, &purchase, &p.Date, &p.Method, &p.AmountCents, &p.Currency, &p.TC); e != nil {
			payments.Close()
			return v, e
		}
		if paymentClient.Valid {
			p.ClientID = &paymentClient.Int64
		}
		if paymentSale.Valid {
			p.SaleID = &paymentSale.Int64
		}
		if purchase.Valid {
			p.PurchaseID = &purchase.Int64
		}
		v.Payments = append(v.Payments, p)
	}
	if e = payments.Err(); e != nil {
		payments.Close()
		return v, e
	}
	payments.Close()
	return v, nil
}
func (s *SalesService) Void(id int64) error { return s.core.void("sales", id, true) }
func (s *SalesService) Restore(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	tx, e := db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var voided sql.NullString
	if e = tx.QueryRow(`SELECT voided_at FROM sales WHERE id=?`, id).Scan(&voided); e != nil {
		return e
	}
	if !voided.Valid {
		return fmt.Errorf("sale is not voided")
	}
	rows, e := tx.Query(`SELECT lot_id,SUM(qty) FROM sale_items WHERE sale_id=? GROUP BY lot_id`, id)
	if e != nil {
		return e
	}
	type need struct{ id, qty int64 }
	items := []need{}
	for rows.Next() {
		var n need
		if e = rows.Scan(&n.id, &n.qty); e != nil {
			rows.Close()
			return e
		}
		items = append(items, n)
	}
	rows.Close()
	for _, n := range items {
		var available int64
		if e = tx.QueryRow(`SELECT available FROM lot_stock WHERE id=?`, n.id).Scan(&available); e != nil {
			return fmt.Errorf("lot %d: lot is unavailable", n.id)
		}
		if available < n.qty {
			return fmt.Errorf("lot %d: insufficient stock to restore sale", n.id)
		}
	}
	_, e = tx.Exec(`UPDATE sales SET voided_at=NULL,updated_at=? WHERE id=?`, now(), id)
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (s *SalesService) AdvanceShipment(id int64) (string, error) {
	db, e := s.core.check()
	if e != nil {
		return "", e
	}
	var status string
	if e = db.QueryRow(`SELECT shipment_status FROM sales WHERE id=? AND kind='shipment' AND voided_at IS NULL`, id).Scan(&status); e != nil {
		return "", e
	}
	next := map[string]string{"prepared": "sent", "sent": "delivered"}[status]
	if next == "" {
		return status, fmt.Errorf("shipment is already delivered")
	}
	_, e = db.Exec(`UPDATE sales SET shipment_status=?,updated_at=? WHERE id=?`, next, now(), id)
	return next, e
}
func (s *SalesService) Summary(id int64, displayCurrency string) (SaleSummary, error) {
	return s.core.saleSummary(id, displayCurrency)
}
func (s *SalesService) Costing(id int64, displayCurrency string) (SaleCosting, error) {
	db, err := s.core.check()
	if err != nil {
		return SaleCosting{}, err
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		displayCurrency = "PEN"
	}
	summary, err := s.core.saleSummary(id, displayCurrency)
	if err != nil {
		return SaleCosting{}, err
	}
	out := SaleCosting{SaleID: id, SalesCents: summary.TotalCents, Currency: displayCurrency}
	rows, err := db.Query(`SELECT si.qty,l.unit_cost_cents,l.currency,l.tc FROM sale_items si JOIN lots l ON l.id=si.lot_id WHERE si.sale_id=?`, id)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var qty, unit, rate int64
		var currency string
		if err = rows.Scan(&qty, &unit, &currency, &rate); err != nil {
			rows.Close()
			return out, err
		}
		amount, e := multiplyMoney(qty, unit)
		if e != nil {
			rows.Close()
			return out, e
		}
		converted, e := money.Convert(money.Money(amount), money.Currency(currency), money.Currency(displayCurrency), rate)
		if e != nil {
			rows.Close()
			return out, e
		}
		out.CostBaseCents, e = sumMoney(out.CostBaseCents, int64(converted))
		if e != nil {
			rows.Close()
			return out, e
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return out, err
	}
	rows.Close()
	extraRows, err := db.Query(`SELECT pe.amount_cents,pe.currency,p.currency,p.tc,COALESCE(SUM(si.qty),0),(SELECT COALESCE(SUM(qty),0) FROM purchase_items WHERE purchase_id=p.id) FROM purchase_extras pe JOIN purchases p ON p.id=pe.purchase_id JOIN purchase_items pi ON pi.purchase_id=p.id JOIN lots l ON l.purchase_item_id=pi.id JOIN sale_items si ON si.lot_id=l.id JOIN sales vs ON vs.id=si.sale_id WHERE vs.id=? AND vs.voided_at IS NULL GROUP BY pe.id`, id)
	if err != nil {
		return out, err
	}
	for extraRows.Next() {
		var amount, rate, qty, totalQty int64
		var currency, purchaseCurrency string
		if err = extraRows.Scan(&amount, &currency, &purchaseCurrency, &rate, &qty, &totalQty); err != nil {
			extraRows.Close()
			return out, err
		}
		if totalQty <= 0 || qty <= 0 {
			continue
		}
		local, e := money.Convert(money.Money(amount), money.Currency(currency), money.Currency(purchaseCurrency), rate)
		if e != nil {
			extraRows.Close()
			return out, e
		}
		converted, e := money.Convert(local, money.Currency(purchaseCurrency), money.Currency(displayCurrency), rate)
		if e != nil {
			extraRows.Close()
			return out, e
		}
		if int64(converted) > 0 && qty > int64(^uint64(0)>>1)/int64(converted) {
			extraRows.Close()
			return out, fmt.Errorf("extra cost share overflow")
		}
		share := int64(converted) * qty / totalQty
		out.CostExtraCents, e = sumMoney(out.CostExtraCents, share)
		if e != nil {
			extraRows.Close()
			return out, e
		}
	}
	if err = extraRows.Err(); err != nil {
		extraRows.Close()
		return out, err
	}
	extraRows.Close()
	out.ProfitCents, err = sumMoney(out.SalesCents, -out.CostBaseCents)
	if err != nil {
		return out, err
	}
	out.ProfitCents, err = sumMoney(out.ProfitCents, -out.CostExtraCents)
	return out, err
}
func (s *SalesService) GetFilterSchema() []map[string]any { return filterSchema("sales") }

func (c *Core) InventorySuggest(productID, qty int64, clientID *int64) ([]SuggestedLot, error) {
	return (&InventoryService{c}).suggest(productID, qty, clientID)
}
func (c *Core) saleSummary(id int64, display string) (SaleSummary, error) {
	db, e := c.check()
	if e != nil {
		return SaleSummary{}, e
	}
	var out SaleSummary
	var currency string
	var rate int64
	if e = db.QueryRow(`SELECT currency,tc FROM sales WHERE id=?`, id).Scan(&currency, &rate); e != nil {
		return out, e
	}
	out.ID = id
	target := currency
	if display == "PEN" || display == "USD" {
		target = display
	}
	out.Currency = target
	out.DocumentCurrency = currency
	var itemTotal, extras, displayedExtras int64
	itemRows, e := db.Query(`SELECT qty,unit_price_cents FROM sale_items WHERE sale_id=?`, id)
	if e != nil {
		return out, e
	}
	for itemRows.Next() {
		var qty, unit int64
		if e = itemRows.Scan(&qty, &unit); e != nil {
			itemRows.Close()
			return out, e
		}
		amount, err := multiplyMoney(qty, unit)
		if err != nil {
			itemRows.Close()
			return out, err
		}
		itemTotal, e = sumMoney(itemTotal, amount)
		if e != nil {
			itemRows.Close()
			return out, e
		}
	}
	if e = itemRows.Err(); e != nil {
		itemRows.Close()
		return out, e
	}
	if e = itemRows.Close(); e != nil {
		return out, e
	}
	rows, e := db.Query(`SELECT amount_cents,currency FROM sale_extras WHERE sale_id=?`, id)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var a int64
		var cur string
		if e = rows.Scan(&a, &cur); e != nil {
			rows.Close()
			return out, e
		}
		v, err := money.Convert(money.Money(a), money.Currency(cur), money.Currency(currency), rate)
		if err != nil {
			rows.Close()
			return out, err
		}
		extras, e = sumMoney(extras, int64(v))
		if e != nil {
			rows.Close()
			return out, e
		}
		amount := v
		if currency != target {
			amount, err = money.Convert(v, money.Currency(currency), money.Currency(target), rate)
			if err != nil {
				rows.Close()
				return out, err
			}
		}
		displayedExtras, e = sumMoney(displayedExtras, int64(amount))
		if e != nil {
			rows.Close()
			return out, e
		}
	}
	rows.Close()
	out.OriginalTotalCents, e = sumMoney(itemTotal, extras)
	if e != nil {
		return out, e
	}
	displayedItems := itemTotal
	if currency != target {
		converted, err := money.Convert(money.Money(itemTotal), money.Currency(currency), money.Currency(target), rate)
		if err != nil {
			return out, err
		}
		displayedItems = int64(converted)
	}
	out.TotalCents, e = sumMoney(displayedItems, displayedExtras)
	if e != nil {
		return out, e
	}
	rows, e = db.Query(`SELECT amount_cents,currency,tc FROM payments WHERE sale_id=? AND kind IN ('payment','advance') AND voided_at IS NULL`, id)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var a, tc int64
		var cur string
		if e = rows.Scan(&a, &cur, &tc); e != nil {
			rows.Close()
			return out, e
		}
		original, err := money.Convert(money.Money(a), money.Currency(cur), money.Currency(currency), tc)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.OriginalPaidCents, e = sumMoney(out.OriginalPaidCents, int64(original))
		if e != nil {
			rows.Close()
			return out, e
		}
		v, err := money.Convert(money.Money(a), money.Currency(cur), money.Currency(target), tc)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.PaidCents, e = sumMoney(out.PaidCents, int64(v))
		if e != nil {
			rows.Close()
			return out, e
		}
	}
	rows.Close()
	out.OriginalBalanceCents, e = sumMoney(out.OriginalTotalCents, -out.OriginalPaidCents)
	if e != nil {
		return out, e
	}
	out.BalanceCents, e = sumMoney(out.TotalCents, -out.PaidCents)
	if e != nil {
		return out, e
	}
	return out, nil
}
