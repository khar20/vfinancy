package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type CatalogService struct{ core *Core }
type Client struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Note  string `json:"note"`
}
type Supplier struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Note  string `json:"note"`
}
type Product struct {
	ID                   int64  `json:"id"`
	SKU                  string `json:"sku"`
	Name                 string `json:"name"`
	DefaultCostCents     int64  `json:"defaultCostCents"`
	DefaultCostCurrency  string `json:"defaultCostCurrency"`
	DefaultCostTC        int64  `json:"defaultCostTc"`
	DefaultPriceCents    int64  `json:"defaultPriceCents"`
	DefaultPriceCurrency string `json:"defaultPriceCurrency"`
	DefaultPriceTC       int64  `json:"defaultPriceTc"`
}
type Card struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Last4         string `json:"last4"`
	CutDay        int    `json:"cutDay"`
	DueDay        int    `json:"dueDay"`
	LimitCents    *int64 `json:"limitCents"`
	LimitCurrency string `json:"limitCurrency"`
	LimitTC       int64  `json:"limitTc"`
}
type Address struct {
	ID       int64  `json:"id"`
	ClientID int64  `json:"clientId"`
	Region   string `json:"region"`
	Address  string `json:"address"`
}

func (s *CatalogService) SaveClient(v Client) (Client, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if e = requireText("name", v.Name); e != nil {
		return v, e
	}
	t := now()
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO clients(name,phone,note,created_at,updated_at) VALUES(?,?,?,?,?)`, v.Name, v.Phone, v.Note, t, t)
		if e != nil {
			return v, e
		}
		v.ID, _ = r.LastInsertId()
	} else {
		r, e := db.Exec(`UPDATE clients SET name=?,phone=?,note=?,updated_at=? WHERE id=?`, v.Name, v.Phone, v.Note, t, v.ID)
		if e != nil {
			return v, e
		}
		if n, _ := r.RowsAffected(); n == 0 {
			return v, sql.ErrNoRows
		}
	}
	return v, nil
}
func (s *CatalogService) QuickCreateClient(name string) (Client, error) {
	return s.SaveClient(Client{Name: name})
}
func (s *CatalogService) ListClients(q ListQuery) (Page, error) {
	return s.core.list("clients", "date", q)
}
func (s *CatalogService) VoidClient(id int64) error    { return s.core.void("clients", id, true) }
func (s *CatalogService) RestoreClient(id int64) error { return s.core.void("clients", id, false) }

func (s *CatalogService) SaveSupplier(v Supplier) (Supplier, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if e = requireText("name", v.Name); e != nil {
		return v, e
	}
	t := now()
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO suppliers(name,phone,note,created_at,updated_at) VALUES(?,?,?,?,?)`, v.Name, v.Phone, v.Note, t, t)
		if e != nil {
			return v, e
		}
		v.ID, _ = r.LastInsertId()
	} else {
		_, e = db.Exec(`UPDATE suppliers SET name=?,phone=?,note=?,updated_at=? WHERE id=?`, v.Name, v.Phone, v.Note, t, v.ID)
		if e != nil {
			return v, e
		}
	}
	return v, nil
}
func (s *CatalogService) QuickCreateSupplier(name string) (Supplier, error) {
	return s.SaveSupplier(Supplier{Name: name})
}
func (s *CatalogService) ListSuppliers(q ListQuery) (Page, error) {
	return s.core.list("suppliers", "date", q)
}
func (s *CatalogService) VoidSupplier(id int64) error    { return s.core.void("suppliers", id, true) }
func (s *CatalogService) RestoreSupplier(id int64) error { return s.core.void("suppliers", id, false) }

func (s *CatalogService) SaveProduct(v Product) (Product, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if e = requireText("sku", v.SKU); e != nil {
		return v, e
	}
	if e = requireText("name", v.Name); e != nil {
		return v, e
	}
	if v.DefaultCostCurrency == "" {
		v.DefaultCostCurrency = "PEN"
	}
	if v.DefaultPriceCurrency == "" {
		v.DefaultPriceCurrency = "PEN"
	}
	if v.DefaultCostTC == 0 {
		v.DefaultCostTC = 37500
	}
	if v.DefaultPriceTC == 0 {
		v.DefaultPriceTC = 37500
	}
	rate, err := defaultTC(db)
	if err != nil {
		return v, err
	}
	v.DefaultCostTC = rate
	v.DefaultPriceTC = rate
	if errs := append(validateMoney("defaultCost", v.DefaultCostCents, v.DefaultCostCurrency, v.DefaultCostTC), validateMoney("defaultPrice", v.DefaultPriceCents, v.DefaultPriceCurrency, v.DefaultPriceTC)...); len(errs) > 0 {
		return v, validation(errs)
	}
	t := now()
	args := []any{v.SKU, v.Name, v.DefaultCostCents, v.DefaultCostCurrency, v.DefaultCostTC, v.DefaultPriceCents, v.DefaultPriceCurrency, v.DefaultPriceTC, t}
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO products(sku,name,default_cost_cents,default_cost_currency,default_cost_tc,default_price_cents,default_price_currency,default_price_tc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, append(args[:8], t, t)...)
		if e != nil {
			return v, constraintError("sku", e)
		}
		v.ID, _ = r.LastInsertId()
	} else {
		_, e = db.Exec(`UPDATE products SET sku=?,name=?,default_cost_cents=?,default_cost_currency=?,default_cost_tc=?,default_price_cents=?,default_price_currency=?,default_price_tc=?,updated_at=? WHERE id=?`, append(args, v.ID)...)
		if e != nil {
			return v, constraintError("sku", e)
		}
	}
	if e = bumpCodeDB(context.Background(), db, v.SKU); e != nil {
		return v, e
	}
	return v, nil
}
func (s *CatalogService) QuickCreateProduct(name string) (Product, error) {
	db, e := s.core.check()
	if e != nil {
		return Product{}, e
	}
	code, e := nextCode(context.Background(), db, "product")
	if e != nil {
		return Product{}, e
	}
	return s.SaveProduct(Product{SKU: code, Name: name, DefaultCostCurrency: "PEN", DefaultPriceCurrency: "PEN", DefaultCostTC: 37500, DefaultPriceTC: 37500})
}
func (s *CatalogService) ListProducts(q ListQuery) (Page, error) {
	return s.core.list("products", "date", q)
}
func (s *CatalogService) VoidProduct(id int64) error    { return s.core.void("products", id, true) }
func (s *CatalogService) RestoreProduct(id int64) error { return s.core.void("products", id, false) }

func (s *CatalogService) SaveCard(v Card) (Card, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if e = requireText("name", v.Name); e != nil {
		return v, e
	}
	if v.LimitCurrency == "" {
		v.LimitCurrency = "PEN"
	}
	if v.LimitTC == 0 {
		v.LimitTC = 37500
	}
	rate, err := defaultTC(db)
	if err != nil {
		return v, err
	}
	v.LimitTC = rate
	if v.CutDay < 1 || v.CutDay > 31 {
		return v, fmt.Errorf("cutDay: must be between 1 and 31")
	}
	if v.DueDay < 1 || v.DueDay > 31 {
		return v, fmt.Errorf("dueDay: must be between 1 and 31")
	}
	t := now()
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO cards(name,last4,cut_day,due_day,limit_cents,limit_currency,limit_tc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, v.Name, v.Last4, v.CutDay, v.DueDay, v.LimitCents, v.LimitCurrency, v.LimitTC, t, t)
		if e != nil {
			return v, e
		}
		v.ID, _ = r.LastInsertId()
	} else {
		_, e := db.Exec(`UPDATE cards SET name=?,last4=?,cut_day=?,due_day=?,limit_cents=?,limit_currency=?,limit_tc=?,updated_at=? WHERE id=?`, v.Name, v.Last4, v.CutDay, v.DueDay, v.LimitCents, v.LimitCurrency, v.LimitTC, t, v.ID)
		if e != nil {
			return v, e
		}
	}
	return v, nil
}
func (s *CatalogService) QuickCreateCard(name string) (Card, error) {
	return s.SaveCard(Card{Name: name, CutDay: 1, DueDay: 1, LimitCurrency: "PEN", LimitTC: 37500})
}
func (s *CatalogService) ListCards(q ListQuery) (Page, error) { return s.core.list("cards", "date", q) }
func (s *CatalogService) VoidCard(id int64) error             { return s.core.void("cards", id, true) }
func (s *CatalogService) RestoreCard(id int64) error          { return s.core.void("cards", id, false) }

func (s *CatalogService) SaveAddress(v Address) (Address, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if v.ClientID <= 0 || strings.TrimSpace(v.Region) == "" || strings.TrimSpace(v.Address) == "" {
		return v, fmt.Errorf("clientId, region and address are required")
	}
	t := now()
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO client_addresses(client_id,region,address,created_at,updated_at) VALUES(?,?,?,?,?)`, v.ClientID, v.Region, v.Address, t, t)
		if e != nil {
			return v, e
		}
		v.ID, _ = r.LastInsertId()
	} else {
		_, e := db.Exec(`UPDATE client_addresses SET region=?,address=?,updated_at=? WHERE id=? AND client_id=?`, v.Region, v.Address, t, v.ID, v.ClientID)
		if e != nil {
			return v, e
		}
	}
	return v, nil
}
func (s *CatalogService) QuickCreateAddress(clientID int64, region, address string) (Address, error) {
	return s.SaveAddress(Address{ClientID: clientID, Region: region, Address: address})
}
func (s *CatalogService) ListAddresses(clientID int64) ([]Address, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	rows, e := db.Query(`SELECT id,client_id,region,address FROM client_addresses WHERE client_id=? ORDER BY id`, clientID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Address{}
	for rows.Next() {
		var v Address
		if e = rows.Scan(&v.ID, &v.ClientID, &v.Region, &v.Address); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *CatalogService) Suggest(entity, text string) ([]map[string]any, error) {
	_, e := s.core.check()
	if e != nil {
		return nil, e
	}
	config := map[string][2]string{"client": {"clients", "name"}, "supplier": {"suppliers", "name"}, "product": {"products", "name"}, "card": {"cards", "name"}, "address": {"client_addresses", "address"}, "concept": {"purchase_extras", "concept"}}
	c, ok := config[strings.ToLower(entity)]
	if !ok {
		return nil, fmt.Errorf("unsupported suggestion entity")
	}
	if strings.ToLower(entity) == "concept" {
		return s.core.rows(`SELECT MIN(id) AS id,concept AS label FROM (SELECT id,concept FROM purchase_extras UNION ALL SELECT id,concept FROM sale_extras) AS all_extras WHERE concept LIKE ? GROUP BY concept ORDER BY label LIMIT 20`, "%"+text+"%")
	}
	return s.core.rows(fmt.Sprintf(`SELECT id,%s AS label FROM %s WHERE %s LIKE ? ORDER BY label LIMIT 20`, c[1], c[0], c[1]), "%"+text+"%")
}
func (s *CatalogService) NextCode(entity string) (string, error) {
	db, e := s.core.check()
	if e != nil {
		return "", e
	}
	return nextCode(context.Background(), db, entity)
}
func (s *CatalogService) GetFilterSchema(entity string) []map[string]any { return filterSchema(entity) }

func mustDB(c *Core) *sql.DB { db, _ := c.check(); return db }
