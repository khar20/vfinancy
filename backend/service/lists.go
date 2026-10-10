package service

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"a/backend/money"
)

type entityConfig struct {
	table, date string
	fields      map[string]string
	total       string
}

var entities = map[string]entityConfig{
	"clients":      {"clients", "created_at", map[string]string{"name": "name", "phone": "phone", "balance": "$clientBalance", "createdAt": "created_at"}, ""},
	"suppliers":    {"suppliers", "created_at", map[string]string{"name": "name", "phone": "phone", "createdAt": "created_at"}, ""},
	"products":     {"products", "created_at", map[string]string{"name": "name", "sku": "sku", "supplier": `(SELECT group_concat(s.name, ', ') FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id WHERE ps.product_id=products.id)`, "stock": `(SELECT COALESCE(SUM(available),0) FROM lot_stock WHERE product_id=products.id)`, "cost": "$productCost", "price": "$productPrice", "createdAt": "created_at"}, "default_price_cents"},
	"cards":        {"cards", "created_at", map[string]string{"name": "name", "last4": "last4"}, ""},
	"purchases":    {"purchases", "date", map[string]string{"code": "code", "supplier": `(SELECT name FROM suppliers WHERE id=purchases.supplier_id)`, "client": `(SELECT name FROM clients WHERE id=purchases.for_client_id)`, "date": "date", "total": "$purchaseTotal", "paymentMethod": "payment_method", "status": "$purchaseStatus"}, ""},
	"lots":         {"lots", "entry_date", map[string]string{"code": "code", "product": `(SELECT name FROM products WHERE id=lots.product_id)`, "entryDate": "entry_date", "available": `(SELECT available FROM lot_stock WHERE id=lots.id)`, "unitCost": "$lotCost", "daysLeft": "$lotDaysLeft", "source": "source", "status": "$lotStatus"}, "unit_cost_cents"},
	"sales":        {"sales", "date", map[string]string{"code": "code", "client": `(SELECT name FROM clients WHERE id=sales.client_id)`, "product": `(SELECT group_concat(p.name, ', ') FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=sales.id)`, "region": "ship_region", "date": "date", "total": "$saleTotal", "balance": "$saleBalance", "status": "$saleStatus", "kind": "kind", "shipmentStatus": "shipment_status"}, ""},
	"payments":     {"payments", "date", map[string]string{"code": "code", "date": "date", "kind": "kind", "method": "method", "amount": "$paymentAmount"}, "amount_cents"},
	"cardExpenses": {"card_expenses", "date", map[string]string{"date": "date", "concept": "concept", "amount": "$cardExpenseAmount"}, "amount_cents"},
}

func (c *Core) list(entity, _ string, q ListQuery) (Page, error) {
	db, err := c.check()
	if err != nil {
		return Page{}, err
	}
	cfg, ok := entities[entity]
	if !ok {
		return Page{}, fmt.Errorf("unknown entity %q", entity)
	}
	where := []string{"1=1"}
	args := []any{}
	for _, f := range q.Filters {
		col, ok := cfg.fields[f.Field]
		if !ok {
			return Page{}, fmt.Errorf("unsupported filter field %q", f.Field)
		}
		col = filterExpression(entity, f.Field, col, q.DisplayCurrency)
		clause, vals, e := makeFilter(col, f)
		if e != nil {
			return Page{}, e
		}
		where = append(where, clause)
		args = append(args, vals...)
	}
	if q.CursorMonth != "" {
		where = append(where, "substr("+cfg.date+",1,7) < ?")
		args = append(args, q.CursorMonth)
	}
	limit := q.MonthsLimit
	if limit <= 0 || limit > 120 {
		limit = 6
	}
	rows, err := rowsDB(db, `SELECT *,substr(`+cfg.date+`,1,7) AS _month FROM `+cfg.table+` WHERE `+strings.Join(where, " AND ")+` ORDER BY `+cfg.date+` DESC,id DESC`, args...)
	if err != nil {
		return Page{}, err
	}
	groups := []MonthGroup{}
	index := map[string]int{}
	for _, row := range rows {
		month, _ := row["_month"].(string)
		if month == "" {
			month = "0000-00"
		}
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
		convertListMoney(row, q.DisplayCurrency)
		if err := c.deriveStatus(entity, row, q.DisplayCurrency); err != nil {
			return Page{}, err
		}
		groups[i].Rows = append(groups[i].Rows, row)
		groups[i].Count++
		if total, ok := numeric(row["totalCents"]); ok {
			groups[i].Total += total
		} else if cfg.total != "" {
			if n, ok := numeric(row[cfg.total]); ok {
				groups[i].Total += n
			}
		}
	}
	page := Page{Months: groups}
	if len(groups) > 0 {
		page.NextCursor = groups[len(groups)-1].Month
	}
	return page, nil
}

func makeFilter(col string, f Filter) (string, []any, error) {
	op := f.Op
	allowed := map[string]bool{"contains": true, "equals": true}
	if strings.Contains(col, "date") || col == "date" || col == "entry_date" || col == "created_at" || strings.Contains(strings.ToLower(f.Field), "date") {
		allowed = map[string]bool{"inMonth": true, "before": true, "after": true, "between": true}
	}
	if strings.Contains(col, "cents") || col == "qty" || col == "available" || col == "stock" || f.Field == "stock" || f.Field == "available" || f.Field == "total" || f.Field == "balance" || f.Field == "cost" || f.Field == "price" || f.Field == "unitCost" || f.Field == "daysLeft" || f.Field == "amount" {
		allowed = map[string]bool{"=": true, "equals": true, ">": true, "<": true, "between": true}
	}
	if strings.Contains(col, "status") || strings.Contains(col, "method") || col == "kind" || col == "source" || col == "shipment_status" || f.Field == "status" || f.Field == "paymentMethod" || f.Field == "kind" || f.Field == "source" || f.Field == "shipmentStatus" || f.Field == "movement" {
		allowed = map[string]bool{"is": true, "equals": true, "isAny": true, "in": true}
	}
	if !allowed[op] {
		return "", nil, fmt.Errorf("operator %q is not allowed for filter %q", op, f.Field)
	}
	switch f.Op {
	case "contains":
		return col + " LIKE ?", []any{"%" + fmt.Sprint(f.Value) + "%"}, nil
	case "equals", "=", "is":
		return col + " = ?", []any{f.Value}, nil
	case ">":
		return col + " > ?", []any{f.Value}, nil
	case "<":
		return col + " < ?", []any{f.Value}, nil
	case "between":
		return col + " BETWEEN ? AND ?", []any{f.Value, f.End}, nil
	case "inMonth", "month":
		return "substr(" + col + ",1,7)=?", []any{f.Value}, nil
	case "before":
		return col + " < ?", []any{f.Value}, nil
	case "after":
		return col + " > ?", []any{f.Value}, nil
	case "in", "isAny":
		vals, ok := f.Value.([]any)
		if !ok || len(vals) == 0 {
			return "", nil, fmt.Errorf("filter %s requires a non-empty list", f.Field)
		}
		marks := strings.TrimSuffix(strings.Repeat("?,", len(vals)), ",")
		return col + " IN (" + marks + ")", vals, nil
	default:
		return "", nil, fmt.Errorf("unsupported filter operator %q", f.Op)
	}
}

func filterExpression(entity, field, col, display string) string {
	if display != "USD" {
		display = "PEN"
	}
	switch col {
	case "$productCost":
		return sqlConvert("default_cost_cents", "default_cost_currency", "default_cost_tc", display)
	case "$productPrice":
		return sqlConvert("default_price_cents", "default_price_currency", "default_price_tc", display)
	case "$lotCost":
		return sqlConvert("unit_cost_cents", "lots.currency", "lots.tc", display)
	case "$lotDaysLeft":
		effective := `COALESCE(lots.countdown_days,CAST((SELECT value FROM settings WHERE key='lot_countdown_days') AS INTEGER))`
		return `(CASE WHEN ` + effective + `>0 THEN ` + effective + `-CAST(julianday('now')-julianday(lots.countdown_start) AS INTEGER) ELSE NULL END)`
	case "$paymentAmount":
		return sqlConvert("amount_cents", "payments.currency", "payments.tc", display)
	case "$cardExpenseAmount":
		return sqlConvert("amount_cents", "card_expenses.currency", "card_expenses.tc", display)
	case "$purchaseTotal":
		items := `(SELECT COALESCE(SUM(qty*unit_cost_cents),0) FROM purchase_items WHERE purchase_id=purchases.id)`
		extra := `(SELECT COALESCE(SUM(CASE WHEN purchase_extras.currency=purchases.currency THEN amount_cents WHEN purchases.currency='PEN' THEN (amount_cents*purchases.tc+5000)/10000 ELSE (amount_cents*10000+purchases.tc/2)/purchases.tc END),0) FROM purchase_extras WHERE purchase_id=purchases.id)`
		return sqlConvert("("+items+"+"+extra+")", "purchases.currency", "purchases.tc", display)
	case "$purchaseStatus":
		return `(CASE WHEN purchases.voided_at IS NOT NULL THEN 'voided' WHEN purchases.status='pending' THEN 'pending' WHEN COALESCE((SELECT SUM(l.qty_initial) FROM purchase_items pi JOIN lots l ON l.purchase_item_id=pi.id WHERE pi.purchase_id=purchases.id),0)>0 AND COALESCE((SELECT SUM(ls.available) FROM purchase_items pi JOIN lots ll ON ll.purchase_item_id=pi.id JOIN lot_stock ls ON ls.id=ll.id WHERE pi.purchase_id=purchases.id),0)=0 THEN 'sold' WHEN EXISTS(SELECT 1 FROM lots l JOIN purchase_items pi ON pi.id=l.purchase_item_id WHERE pi.purchase_id=purchases.id AND l.reserved_client_id IS NOT NULL) THEN 'reserved' ELSE 'received' END)`
	case "$lotStatus":
		return `(CASE WHEN lots.voided_at IS NOT NULL THEN 'voided' WHEN COALESCE((SELECT available FROM lot_stock WHERE id=lots.id),0)=0 THEN 'depleted' WHEN lots.reserved_client_id IS NOT NULL THEN 'reserved' WHEN COALESCE(lots.countdown_days,CAST((SELECT value FROM settings WHERE key='lot_countdown_days') AS INTEGER))>0 AND date('now')>=date(lots.countdown_start,'+'||COALESCE(lots.countdown_days,CAST((SELECT value FROM settings WHERE key='lot_countdown_days') AS INTEGER))||' days') THEN 'auction' ELSE 'active' END)`
	case "$saleTotal", "$saleBalance":
		items := `(SELECT COALESCE(SUM(qty*unit_price_cents),0) FROM sale_items WHERE sale_id=sales.id)`
		extra := `(SELECT COALESCE(SUM(CASE WHEN sale_extras.currency=sales.currency THEN amount_cents WHEN sales.currency='PEN' THEN (amount_cents*sales.tc+5000)/10000 ELSE (amount_cents*10000+sales.tc/2)/sales.tc END),0) FROM sale_extras WHERE sale_id=sales.id)`
		total := sqlConvert("("+items+"+"+extra+")", "sales.currency", "sales.tc", display)
		if col == "$saleTotal" {
			return total
		}
		paid := `(SELECT COALESCE(SUM(` + sqlConvert("amount_cents", "payments.currency", "payments.tc", display) + `),0) FROM payments WHERE sale_id=sales.id AND voided_at IS NULL)`
		return "(" + total + "-" + paid + ")"
	case "$saleStatus":
		balance := filterExpression("sales", "balance", "$saleBalance", display)
		return `(CASE WHEN sales.voided_at IS NOT NULL THEN 'voided' WHEN sales.kind='shipment' THEN sales.shipment_status WHEN ` + balance + `<=0 THEN 'paid' WHEN sales.date<date('now','-'||(SELECT value FROM settings WHERE key='overdue_days')||' days') THEN 'overdue' ELSE 'balance' END)`
	case "$clientBalance":
		balance := filterExpression("sales", "balance", "$saleBalance", display)
		return `(SELECT COALESCE(SUM(` + balance + `),0) FROM sales WHERE sales.client_id=clients.id AND sales.voided_at IS NULL)`
	}
	return col
}

func sqlConvert(amount, currency, rate, display string) string {
	if display == "USD" {
		return `(CASE WHEN ` + currency + `='USD' THEN ` + amount + ` ELSE (` + amount + `*10000+` + rate + `/2)/` + rate + ` END)`
	}
	return `(CASE WHEN ` + currency + `='PEN' THEN ` + amount + ` ELSE (` + amount + `*` + rate + `+5000)/10000 END)`
}

func rowsDB(db *sql.DB, q string, args ...any) ([]map[string]any, error) {
	rs, e := db.Query(q, args...)
	if e != nil {
		return nil, e
	}
	defer rs.Close()
	cols, e := rs.Columns()
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for rs.Next() {
		v := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range v {
			ptr[i] = &v[i]
		}
		if e = rs.Scan(ptr...); e != nil {
			return nil, e
		}
		r := map[string]any{}
		for i, k := range cols {
			switch x := v[i].(type) {
			case []byte:
				r[k] = string(x)
			default:
				r[k] = x
			}
		}
		out = append(out, r)
	}
	return out, rs.Err()
}
func numeric(v any) (int64, bool) {
	switch x := v.(type) {
	case int64:
		return x, true
	case int:
		return int64(x), true
	case string:
		n, e := strconv.ParseInt(x, 10, 64)
		return n, e == nil
	}
	return 0, false
}
func convertListMoney(row map[string]any, display string) {
	if display != "PEN" && display != "USD" {
		return
	}
	for _, key := range []string{"amount_cents", "unit_cost_cents", "default_cost_cents", "default_price_cents", "limit_cents"} {
		amount, ok := numeric(row[key])
		if !ok || row[key] == nil {
			continue
		}
		currency, _ := row["currency"].(string)
		if currency == "" {
			currency, _ = row[strings.TrimSuffix(key, "_cents")+"_currency"].(string)
		}
		tc, _ := numeric(row["tc"])
		if tc == 0 {
			tc, _ = numeric(row[strings.TrimSuffix(key, "_cents")+"_tc"])
		}
		if tc == 0 {
			tc, _ = numeric(row["tc"])
		}
		if currency == "" || tc == 0 || currency == display {
			continue
		}
		converted, err := money.Convert(money.Money(amount), money.Currency(currency), money.Currency(display), tc)
		if err == nil {
			row["original_"+key] = amount
			row[key] = int64(converted)
		}
	}
}

func (c *Core) deriveStatus(entity string, row map[string]any, display string) error {
	db, err := c.check()
	if err != nil {
		return err
	}
	id, ok := numeric(row["id"])
	if !ok {
		return nil
	}
	voided := row["voided_at"] != nil && row["voided_at"] != ""
	switch entity {
	case "purchases":
		status, _ := row["status"].(string)
		if voided {
			row["status"] = "voided"
		} else if status == "pending" {
			row["status"] = "pending"
		} else {
			var total, available, sold int64
			if err = db.QueryRow(`SELECT COALESCE(SUM(l.qty_initial),0),COALESCE(SUM(ls.available),0),COALESCE(SUM(l.qty_initial-ls.available),0) FROM purchase_items pi JOIN lots l ON l.purchase_item_id=pi.id JOIN lot_stock ls ON ls.id=l.id WHERE pi.purchase_id=?`, id).Scan(&total, &available, &sold); err != nil {
				return err
			}
			if total > 0 && available == 0 {
				row["status"] = "sold"
			} else if sold == 0 {
				var reserved int
				_ = db.QueryRow(`SELECT COUNT(*) FROM lots WHERE purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id=?) AND reserved_client_id IS NOT NULL`, id).Scan(&reserved)
				if reserved > 0 {
					row["status"] = "reserved"
				} else {
					row["status"] = "received"
				}
			} else {
				row["status"] = "received"
			}
			row["soldQty"] = sold
			row["totalQty"] = total
		}
		if currency, ok := row["currency"].(string); ok {
			var rate int64
			_ = db.QueryRow(`SELECT tc FROM purchases WHERE id=?`, id).Scan(&rate)
			var items int64
			_ = db.QueryRow(`SELECT COALESCE(SUM(qty*unit_cost_cents),0) FROM purchase_items WHERE purchase_id=?`, id).Scan(&items)
			extras, e := db.Query(`SELECT amount_cents,currency FROM purchase_extras WHERE purchase_id=?`, id)
			if e != nil {
				return e
			}
			for extras.Next() {
				var amount int64
				var cur string
				if e = extras.Scan(&amount, &cur); e != nil {
					extras.Close()
					return e
				}
				converted, e := money.Convert(money.Money(amount), money.Currency(cur), money.Currency(currency), rate)
				if e != nil {
					extras.Close()
					return e
				}
				items += int64(converted)
			}
			extras.Close()
			row["originalTotalCents"] = items
			target := display
			if target != "PEN" && target != "USD" {
				target = currency
			}
			if target != currency {
				converted, e := money.Convert(money.Money(items), money.Currency(currency), money.Currency(target), rate)
				if e != nil {
					return e
				}
				items = int64(converted)
			}
			row["totalCents"] = items
			row["displayCurrency"] = target
		}
	case "lots":
		if voided {
			row["status"] = "voided"
			return nil
		}
		var available int64
		_ = db.QueryRow(`SELECT available FROM lot_stock WHERE id=?`, id).Scan(&available)
		row["available"] = available
		var days sql.NullInt64
		var start string
		_ = db.QueryRow(`SELECT countdown_days,countdown_start FROM lots WHERE id=?`, id).Scan(&days, &start)
		effective := 0
		if days.Valid {
			effective = int(days.Int64)
		} else {
			var setting string
			_ = db.QueryRow(`SELECT value FROM settings WHERE key='lot_countdown_days'`).Scan(&setting)
			_, _ = fmt.Sscanf(setting, "%d", &effective)
		}
		remaining := 0
		countdownValid := false
		if effective > 0 {
			started, e := time.Parse("2006-01-02", start)
			if e == nil {
				countdownValid = true
				remaining = effective - int(time.Since(started).Hours()/24)
				row["daysLeft"] = remaining
			}
		}
		if available == 0 {
			row["status"] = "depleted"
			return nil
		}
		if row["reserved_client_id"] != nil {
			row["status"] = "reserved"
			return nil
		}
		if countdownValid && remaining <= 0 {
			row["status"] = "auction"
			row["daysInAuction"] = -remaining
			return nil
		}
		row["status"] = "active"
	case "sales":
		kind, _ := row["kind"].(string)
		if kind == "shipment" {
			if voided {
				row["status"] = "voided"
			} else {
				row["status"] = row["shipment_status"]
			}
			summary, e := c.saleSummary(id, display)
			if e != nil {
				return e
			}
			row["balanceCents"] = summary.BalanceCents
			row["totalCents"] = summary.TotalCents
			row["originalBalanceCents"] = summary.OriginalBalanceCents
			row["originalTotalCents"] = summary.OriginalTotalCents
			row["originalPaidCents"] = summary.OriginalPaidCents
			row["documentCurrency"] = summary.DocumentCurrency
			row["displayCurrency"] = summary.Currency
			return nil
		}
		summary, e := c.saleSummary(id, display)
		if e != nil {
			return e
		}
		row["balanceCents"] = summary.BalanceCents
		row["totalCents"] = summary.TotalCents
		row["originalBalanceCents"] = summary.OriginalBalanceCents
		row["originalTotalCents"] = summary.OriginalTotalCents
		row["originalPaidCents"] = summary.OriginalPaidCents
		row["documentCurrency"] = summary.DocumentCurrency
		row["displayCurrency"] = summary.Currency
		if voided {
			row["status"] = "voided"
			return nil
		}
		if summary.BalanceCents <= 0 {
			row["status"] = "paid"
		} else {
			overdue := 30
			var setting string
			if db.QueryRow(`SELECT value FROM settings WHERE key='overdue_days'`).Scan(&setting) == nil {
				_, _ = fmt.Sscanf(setting, "%d", &overdue)
			}
			date, _ := row["date"].(string)
			when, e := time.Parse("2006-01-02", date)
			if e == nil && when.Before(time.Now().AddDate(0, 0, -overdue)) {
				row["status"] = "overdue"
			} else {
				row["status"] = "balance"
			}
		}
	case "payments":
		if voided {
			row["status"] = "voided"
		} else if row["kind"] == "advance" {
			status, _ := row["advance_status"].(string)
			if status == "refunded" {
				row["status"] = "refunded"
			} else if status == "applied" {
				row["status"] = "applied"
			} else {
				row["status"] = "active"
			}
		}
	case "clients":
		if voided {
			row["status"] = "voided"
			return nil
		}
		var ids []int64
		rows, e := db.Query(`SELECT id FROM sales WHERE client_id=? AND voided_at IS NULL`, id)
		if e != nil {
			return e
		}
		for rows.Next() {
			var sale int64
			if e = rows.Scan(&sale); e != nil {
				rows.Close()
				return e
			}
			ids = append(ids, sale)
		}
		rows.Close()
		var balance int64
		for _, sale := range ids {
			summary, e := c.saleSummary(sale, display)
			if e != nil {
				return e
			}
			balance += summary.BalanceCents
		}
		row["balanceCents"] = balance
		if balance > 0 {
			row["status"] = "balance"
		}
	case "products", "suppliers", "cards", "cardExpenses":
		if voided {
			row["status"] = "voided"
		}
	}
	return nil
}
func filterSchema(entity string) []map[string]any {
	if entity == "cardCycles" || entity == "cycles" {
		return []map[string]any{{"field": "card", "type": "text", "operators": []string{"contains", "equals"}}, {"field": "cycleEnd", "type": "date", "operators": []string{"inMonth", "before", "after", "between"}}, {"field": "total", "type": "number", "operators": []string{"=", ">", "<", "between"}}, {"field": "status", "type": "option", "operators": []string{"is", "isAny"}}}
	}
	if entity == "kardex" {
		return []map[string]any{{"field": "date", "type": "date", "operators": []string{"inMonth", "before", "after", "between"}}, {"field": "movement", "type": "option", "operators": []string{"is", "isAny"}}, {"field": "qty", "type": "number", "operators": []string{"=", ">", "<", "between"}}}
	}
	cfg, ok := entities[entity]
	if !ok {
		return []map[string]any{}
	}
	result := make([]map[string]any, 0, len(cfg.fields))
	names := make([]string, 0, len(cfg.fields))
	for name := range cfg.fields {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		col := cfg.fields[name]
		typ := "text"
		ops := []string{"contains", "equals"}
		if strings.Contains(col, "date") || col == "date" || col == "entry_date" || strings.Contains(strings.ToLower(name), "date") {
			typ = "date"
			ops = []string{"inMonth", "before", "after", "between"}
		}
		if strings.Contains(col, "status") || strings.Contains(col, "method") || col == "kind" || col == "source" || name == "status" || name == "paymentMethod" || name == "shipmentStatus" {
			typ = "option"
			ops = []string{"is", "isAny"}
		}
		if strings.Contains(col, "cents") || name == "stock" || name == "available" || name == "cost" || name == "price" || name == "unitCost" || name == "daysLeft" || name == "total" || name == "balance" || name == "amount" {
			typ = "number"
			ops = []string{"=", ">", "<", "between"}
		}
		result = append(result, map[string]any{"field": name, "type": typ, "operators": ops})
	}
	return result
}
func (c *Core) void(table string, id int64, void bool) error {
	db, e := c.check()
	if e != nil {
		return e
	}
	valid := map[string]bool{"clients": true, "suppliers": true, "products": true, "cards": true, "purchases": true, "lots": true, "sales": true, "payments": true, "card_expenses": true}
	if !valid[table] {
		return fmt.Errorf("unsupported entity")
	}
	value := any(now())
	if !void {
		value = nil
	}
	r, e := db.Exec(`UPDATE `+table+` SET voided_at=?,updated_at=? WHERE id=?`, value, now(), id)
	if e != nil {
		return e
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
