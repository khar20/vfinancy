package service

import (
	"database/sql"
	"fmt"
	"sort"
	"time"

	"a/backend/money"
)

type DashboardService struct{ core *Core }

func (s *DashboardService) GetDashboard(period, anchor, displayCurrency string) (map[string]any, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		displayCurrency = "PEN"
	}
	start, end, e := periodRange(period, anchor)
	if e != nil {
		return nil, e
	}
	var sales, costBase, costExtra int64
	byMonth := map[string]map[string]int64{}
	extrasConcept := map[string]int64{}
	receivables := map[string]int64{}
	receivableRows := map[string][]map[string]any{}
	rows, e := db.Query(`SELECT id,date,currency,tc,code FROM sales WHERE voided_at IS NULL AND date>=? AND date<? ORDER BY date`, start, end)
	if e != nil {
		return nil, e
	}
	type saleRef struct {
		id        int64
		date, cur string
		code      string
		tc        int64
	}
	saleList := []saleRef{}
	for rows.Next() {
		var v saleRef
		if e = rows.Scan(&v.id, &v.date, &v.cur, &v.tc, &v.code); e != nil {
			rows.Close()
			return nil, e
		}
		saleList = append(saleList, v)
	}
	rows.Close()
	for _, v := range saleList {
		month := v.date[:7]
		if byMonth[month] == nil {
			byMonth[month] = map[string]int64{}
		}
		summary, e := s.core.saleSummary(v.id, displayCurrency)
		if e != nil {
			return nil, e
		}
		sales += summary.TotalCents
		byMonth[month]["sales"] += summary.TotalCents
		if summary.BalanceCents > 0 {
			receivables[month] += summary.BalanceCents
			receivableRows[month] = append(receivableRows[month], map[string]any{"id": v.id, "code": v.code, "date": v.date, "balanceCents": summary.BalanceCents, "currency": summary.Currency})
		}
		var rows *sql.Rows
		rows, e = db.Query(`SELECT si.qty,l.unit_cost_cents,l.currency,l.tc FROM sale_items si JOIN lots l ON l.id=si.lot_id WHERE si.sale_id=?`, v.id)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var qty, cost, tc int64
			var cur string
			if e = rows.Scan(&qty, &cost, &cur, &tc); e != nil {
				rows.Close()
				return nil, e
			}
			if qty != 0 && cost > int64(^uint64(0)>>1)/qty {
				rows.Close()
				return nil, fmt.Errorf("cost overflow")
			}
			converted, err := money.Convert(money.Money(qty*cost), money.Currency(cur), money.Currency(displayCurrency), tc)
			if err != nil {
				rows.Close()
				return nil, err
			}
			costBase += int64(converted)
			byMonth[month]["costBase"] += int64(converted)
		}
		rows.Close()
		rows, e = db.Query(`SELECT pe.concept,pe.amount_cents,pe.currency,p.currency,p.tc,COALESCE(SUM(si.qty),0),(SELECT COALESCE(SUM(qty),0) FROM purchase_items WHERE purchase_id=p.id) total_qty FROM purchase_extras pe JOIN purchases p ON p.id=pe.purchase_id JOIN purchase_items pi ON pi.purchase_id=p.id JOIN lots l ON l.purchase_item_id=pi.id JOIN sale_items si ON si.lot_id=l.id JOIN sales vs ON vs.id=si.sale_id WHERE vs.id=? AND vs.voided_at IS NULL GROUP BY pe.id`, v.id)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var concept, cur, docCurrency string
			var amount, tc, qty, total int64
			if e = rows.Scan(&concept, &amount, &cur, &docCurrency, &tc, &qty, &total); e != nil {
				rows.Close()
				return nil, e
			}
			if total <= 0 {
				continue
			}
			local, err := money.Convert(money.Money(amount), money.Currency(cur), money.Currency(docCurrency), tc)
			if err != nil {
				rows.Close()
				return nil, err
			}
			converted, err := money.Convert(local, money.Currency(docCurrency), money.Currency(displayCurrency), tc)
			if err != nil {
				rows.Close()
				return nil, err
			}
			share := int64(converted) * qty / total
			costExtra += share
			byMonth[month]["costExtra"] += share
			extrasConcept[concept] += share
		}
		rows.Close()
	}
	var auctions []map[string]any
	auctions, e = s.auctions(db)
	if e != nil {
		return nil, e
	}
	cycles, e := (&CardService{s.core}).Cycles(displayCurrency)
	if e != nil {
		return nil, e
	}
	cardAlerts := []CardCycle{}
	for _, v := range cycles {
		if v.Status == "due" || v.Status == "overdue" {
			cardAlerts = append(cardAlerts, v)
		}
	}
	var overdueDays int = 30
	var overdueText string
	if db.QueryRow(`SELECT value FROM settings WHERE key='overdue_days'`).Scan(&overdueText) == nil {
		if n, err := fmt.Sscanf(overdueText, "%d", &overdueDays); err != nil || n < 1 {
			overdueDays = 30
		}
	}
	cutoff := time.Now().AddDate(0, 0, -overdueDays).Format("2006-01-02")
	pending, e := s.core.rows(`SELECT id,code,date,supplier_id FROM purchases WHERE status='pending' AND voided_at IS NULL AND date<? ORDER BY date`, cutoff)
	if e != nil {
		return nil, e
	}
	overdueSales := []map[string]any{}
	lateRows, e := db.Query(`SELECT id,code,date,kind FROM sales WHERE voided_at IS NULL AND date<? ORDER BY date`, cutoff)
	if e != nil {
		return nil, e
	}
	type lateSale struct {
		id               int64
		code, date, kind string
	}
	late := []lateSale{}
	for lateRows.Next() {
		var item lateSale
		if e = lateRows.Scan(&item.id, &item.code, &item.date, &item.kind); e != nil {
			lateRows.Close()
			return nil, e
		}
		late = append(late, item)
	}
	if e = lateRows.Close(); e != nil {
		return nil, e
	}
	for _, item := range late {
		summary, err := s.core.saleSummary(item.id, displayCurrency)
		if err != nil {
			return nil, err
		}
		if summary.BalanceCents > 0 {
			overdueSales = append(overdueSales, map[string]any{"id": item.id, "code": item.code, "date": item.date, "kind": item.kind, "balanceCents": summary.BalanceCents, "currency": summary.Currency})
		}
	}
	for _, m := range byMonth {
		m["profit"] = m["sales"] - m["costBase"] - m["costExtra"]
	}
	profit := sales - costBase - costExtra
	series := []map[string]any{}
	months := make([]string, 0, len(byMonth))
	for month := range byMonth {
		months = append(months, month)
	}
	sort.Strings(months)
	for _, month := range months {
		m := byMonth[month]
		series = append(series, map[string]any{"month": month, "sales": m["sales"], "costBase": m["costBase"], "costExtra": m["costExtra"], "profit": m["profit"]})
	}
	concepts := []map[string]any{}
	conceptNames := make([]string, 0, len(extrasConcept))
	for name := range extrasConcept {
		conceptNames = append(conceptNames, name)
	}
	sort.Strings(conceptNames)
	for _, name := range conceptNames {
		value := extrasConcept[name]
		concepts = append(concepts, map[string]any{"concept": name, "amount": value})
	}
	return map[string]any{"period": period, "anchor": anchor, "currency": displayCurrency, "sales": sales, "costBase": costBase, "costExtra": costExtra, "profit": profit, "extrasByConcept": concepts, "series": series, "receivables": receivables, "receivableRows": receivableRows, "auctions": auctions, "alerts": map[string]any{"pendingPurchases": pending, "cardCycles": cardAlerts, "overdueSales": overdueSales}}, nil
}
func (s *DashboardService) auctions(db *sql.DB) ([]map[string]any, error) {
	var global int
	var text string
	if db.QueryRow(`SELECT value FROM settings WHERE key='lot_countdown_days'`).Scan(&text) == nil {
		_, _ = fmt.Sscanf(text, "%d", &global)
	}
	rows, e := db.Query(`SELECT ls.id,l.code,l.product_id,p.name,ls.available,l.countdown_days,l.countdown_start,l.entry_date FROM lot_stock ls JOIN lots l ON l.id=ls.id JOIN products p ON p.id=l.product_id WHERE ls.available>0 ORDER BY l.entry_date`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	todayDate, _ := time.Parse("2006-01-02", today())
	for rows.Next() {
		var id, product, available int64
		var code, name, start, entryDate string
		var days sql.NullInt64
		if e = rows.Scan(&id, &code, &product, &name, &available, &days, &start, &entryDate); e != nil {
			return nil, e
		}
		count := global
		if days.Valid {
			count = int(days.Int64)
		}
		if count <= 0 {
			continue
		}
		startDate, err := time.Parse("2006-01-02", start)
		if err != nil {
			continue
		}
		auction := !todayDate.Before(startDate.AddDate(0, 0, count))
		if auction {
			out = append(out, map[string]any{"id": id, "code": code, "productId": product, "product": name, "available": available, "entryDate": entryDate, "days": count, "daysInAuction": int(todayDate.Sub(startDate.AddDate(0, 0, count)).Hours() / 24)})
		}
	}
	return out, rows.Err()
}
func periodRange(period, anchor string) (string, string, error) {
	var date time.Time
	var err error
	if anchor == "" {
		date = time.Now()
	} else {
		date, err = time.Parse("2006-01-02", anchor)
		if err != nil {
			date, err = time.Parse("2006-01", anchor)
			if err != nil {
				return "", "", fmt.Errorf("anchor must be YYYY-MM or YYYY-MM-DD")
			}
		}
	}
	date = time.Date(date.Year(), date.Month(), 1, 0, 0, 0, 0, time.UTC)
	switch period {
	case "month", "mes", "":
		return date.Format("2006-01-02"), date.AddDate(0, 1, 0).Format("2006-01-02"), nil
	case "quarter", "trimestre":
		month := ((int(date.Month())-1)/3)*3 + 1
		date = time.Date(date.Year(), time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		return date.Format("2006-01-02"), date.AddDate(0, 3, 0).Format("2006-01-02"), nil
	case "year", "año", "ano":
		date = time.Date(date.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
		return date.Format("2006-01-02"), date.AddDate(1, 0, 0).Format("2006-01-02"), nil
	case "total":
		return "0000-01-01", "9999-12-31", nil
	default:
		return "", "", fmt.Errorf("period must be month, quarter, year, or total")
	}
}
