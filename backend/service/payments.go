package service

import (
	"context"
	"database/sql"
	"fmt"

	"a/backend/codes"
)

type PaymentService struct{ core *Core }
type Payment struct {
	ID          int64  `json:"id"`
	Code        string `json:"code"`
	Kind        string `json:"kind"`
	ClientID    *int64 `json:"clientId"`
	SaleID      *int64 `json:"saleId"`
	PurchaseID  *int64 `json:"purchaseId"`
	Date        string `json:"date"`
	Method      string `json:"method"`
	AmountCents int64  `json:"amountCents"`
	Currency    string `json:"currency"`
	TC          int64  `json:"tc"`
}

func (s *PaymentService) NextCode() (string, error)             { return s.core.CatalogNextCode("payment") }
func (s *PaymentService) AddPayment(v Payment) (Payment, error) { v.Kind = "payment"; return s.save(v) }
func (s *PaymentService) AddAdvance(v Payment) (Payment, error) { v.Kind = "advance"; return s.save(v) }
func (s *PaymentService) save(v Payment) (Payment, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if v.Date == "" {
		v.Date = today()
	}
	if e = validateDate("date", v.Date); e != nil {
		return v, e
	}
	if errs := validateMoney("amountCents", v.AmountCents, v.Currency, v.TC); len(errs) > 0 {
		return v, validation(errs)
	}
	if v.Code == "" {
		v.Code, e = nextCode(context.Background(), db, "payment")
		if e != nil {
			return v, e
		}
	}
	if v.Kind == "payment" && (v.SaleID == nil || *v.SaleID <= 0) {
		return v, fmt.Errorf("saleId: required for a payment")
	}
	if v.Kind == "payment" {
		var currency string
		if e = db.QueryRow(`SELECT currency FROM sales WHERE id=? AND voided_at IS NULL`, *v.SaleID).Scan(&currency); e != nil {
			return v, e
		}
		if currency != v.Currency {
			return v, fmt.Errorf("currency: payments must use the sale currency")
		}
	}
	if v.Kind == "advance" && (v.ClientID == nil || *v.ClientID <= 0 || v.PurchaseID == nil || *v.PurchaseID <= 0) {
		return v, fmt.Errorf("clientId and purchaseId are required for an advance")
	}
	if v.Kind == "advance" {
		var owner sql.NullInt64
		if e = db.QueryRow(`SELECT for_client_id FROM purchases WHERE id=? AND voided_at IS NULL`, *v.PurchaseID).Scan(&owner); e != nil {
			return v, e
		}
		if !owner.Valid || owner.Int64 != *v.ClientID {
			return v, fmt.Errorf("clientId: purchase is not reserved for this client")
		}
	}
	t := now()
	var status any
	if v.Kind == "advance" {
		status = "active"
	}
	tx, e := db.Begin()
	if e != nil {
		return v, e
	}
	defer tx.Rollback()
	r, e := tx.Exec(`INSERT INTO payments(code,kind,client_id,sale_id,purchase_id,date,method,amount_cents,currency,tc,advance_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.Code, v.Kind, v.ClientID, v.SaleID, v.PurchaseID, v.Date, v.Method, v.AmountCents, v.Currency, v.TC, status, t, t)
	if e != nil {
		return v, constraintError("code", e)
	}
	v.ID, _ = r.LastInsertId()
	if e = codes.Bump(context.Background(), tx, v.Code); e != nil {
		return v, e
	}
	if v.Method == "card" || v.Method == "cash" || v.Method == "wallet" {
		if _, e = tx.Exec(`INSERT INTO settings(key,value) VALUES('last_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, v.Method); e != nil {
			return v, e
		}
	}
	if e = tx.Commit(); e != nil {
		return v, e
	}
	return v, nil
}
func (s *PaymentService) RefundAdvance(id int64) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	r, e := db.Exec(`UPDATE payments SET advance_status='refunded',updated_at=? WHERE id=? AND kind='advance' AND advance_status='active' AND voided_at IS NULL`, now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return fmt.Errorf("advance: not found or is no longer active")
	}
	return nil
}
func (s *PaymentService) List(q ListQuery) (Page, error) { return s.core.list("payments", "date", q) }
func (s *PaymentService) Void(id int64) error            { return s.core.void("payments", id, true) }
func (s *PaymentService) Restore(id int64) error         { return s.core.void("payments", id, false) }

func (s *PaymentService) Save(v Payment) (Payment, error) {
	if v.ID == 0 {
		return s.save(v)
	}
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if errs := validateMoney("amountCents", v.AmountCents, v.Currency, v.TC); len(errs) > 0 {
		return v, validation(errs)
	}
	if v.Code == "" {
		if e = db.QueryRow(`SELECT code FROM payments WHERE id=?`, v.ID).Scan(&v.Code); e != nil {
			return v, e
		}
	}
	tx, e := db.Begin()
	if e != nil {
		return v, e
	}
	defer tx.Rollback()
	_, e = tx.Exec(`UPDATE payments SET code=?,date=?,method=?,amount_cents=?,currency=?,tc=?,updated_at=? WHERE id=? AND voided_at IS NULL`, v.Code, v.Date, v.Method, v.AmountCents, v.Currency, v.TC, now(), v.ID)
	if e != nil {
		return v, constraintError("code", e)
	}
	if e = codes.Bump(context.Background(), tx, v.Code); e != nil {
		return v, e
	}
	if v.Method == "card" || v.Method == "cash" || v.Method == "wallet" {
		if _, e = tx.Exec(`INSERT INTO settings(key,value) VALUES('last_payment_method',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, v.Method); e != nil {
			return v, e
		}
	}
	e = tx.Commit()
	return v, e
}
