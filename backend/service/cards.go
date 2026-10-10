package service

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"a/backend/money"
)

type CardService struct{ core *Core }
type CardExpense struct {
	ID          int64  `json:"id"`
	CardID      int64  `json:"cardId"`
	Date        string `json:"date"`
	Concept     string `json:"concept"`
	AmountCents int64  `json:"amountCents"`
	Currency    string `json:"currency"`
	TC          int64  `json:"tc"`
}
type CardCycle struct {
	CardID     int64  `json:"cardId"`
	CardName   string `json:"cardName"`
	CycleEnd   string `json:"cycleEnd"`
	DueDate    string `json:"dueDate"`
	TotalCents int64  `json:"totalCents"`
	Currency   string `json:"currency"`
	PaidDate   string `json:"paidDate,omitempty"`
	Status     string `json:"status"`
}

type CardCharge struct {
	ID                  int64  `json:"id"`
	Date                string `json:"date"`
	Concept             string `json:"concept"`
	Source              string `json:"source"`
	RefCode             string `json:"refCode,omitempty"`
	AmountCents         int64  `json:"amountCents"`
	OriginalAmountCents int64  `json:"originalAmountCents"`
	Currency            string `json:"currency"`
	DisplayCurrency     string `json:"displayCurrency"`
	TC                  int64  `json:"tc"`
}

func cycleEndForDate(date string, cutDay int) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Time{}, err
	}
	month := time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, time.UTC)
	if parsed.Day() > cutDay {
		month = month.AddDate(0, 1, 0)
	}
	end := month.AddDate(0, 1, -1)
	if cutDay < end.Day() {
		end = time.Date(month.Year(), month.Month(), cutDay, 0, 0, 0, 0, time.UTC)
	}
	return end, nil
}

func (s *CardService) Charges(cardID int64, cycleEnd, displayCurrency string) ([]CardCharge, error) {
	db, err := s.core.check()
	if err != nil {
		return nil, err
	}
	if err = validateDate("cycleEnd", cycleEnd); err != nil {
		return nil, err
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		displayCurrency = "PEN"
	}
	var cutDay int
	if err = db.QueryRow(`SELECT cut_day FROM cards WHERE id=? AND voided_at IS NULL`, cardID).Scan(&cutDay); err != nil {
		return nil, err
	}
	charges := []CardCharge{}
	rows, err := db.Query(`SELECT p.id,p.code,p.date,p.currency,p.tc,s.name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.card_id=? AND p.payment_method='card' AND p.voided_at IS NULL ORDER BY p.date,p.id`, cardID)
	if err != nil {
		return nil, err
	}
	type purchaseCharge struct {
		id, tc                         int64
		code, date, currency, supplier string
	}
	purchases := []purchaseCharge{}
	for rows.Next() {
		var purchase purchaseCharge
		if err = rows.Scan(&purchase.id, &purchase.code, &purchase.date, &purchase.currency, &purchase.tc, &purchase.supplier); err != nil {
			rows.Close()
			return nil, err
		}
		purchases = append(purchases, purchase)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, purchase := range purchases {
		end, e := cycleEndForDate(purchase.date, cutDay)
		if e != nil || end.Format("2006-01-02") != cycleEnd {
			continue
		}
		var original int64
		if e = db.QueryRow(`SELECT COALESCE(SUM(qty*unit_cost_cents),0) FROM purchase_items WHERE purchase_id=?`, purchase.id).Scan(&original); e != nil {
			return nil, e
		}
		extraRows, e := db.Query(`SELECT amount_cents,currency FROM purchase_extras WHERE purchase_id=?`, purchase.id)
		if e != nil {
			return nil, e
		}
		for extraRows.Next() {
			var amount int64
			var currency string
			if e = extraRows.Scan(&amount, &currency); e != nil {
				extraRows.Close()
				return nil, e
			}
			converted, convertErr := money.Convert(money.Money(amount), money.Currency(currency), money.Currency(purchase.currency), purchase.tc)
			if convertErr != nil {
				extraRows.Close()
				return nil, convertErr
			}
			original, e = sumMoney(original, int64(converted))
			if e != nil {
				extraRows.Close()
				return nil, e
			}
		}
		if e = extraRows.Err(); e != nil {
			extraRows.Close()
			return nil, e
		}
		extraRows.Close()
		shown, e := money.Convert(money.Money(original), money.Currency(purchase.currency), money.Currency(displayCurrency), purchase.tc)
		if e != nil {
			return nil, e
		}
		charges = append(charges, CardCharge{ID: purchase.id, Date: purchase.date, Concept: purchase.supplier, Source: "purchase", RefCode: purchase.code, AmountCents: int64(shown), OriginalAmountCents: original, Currency: purchase.currency, DisplayCurrency: displayCurrency, TC: purchase.tc})
	}
	expenses, err := db.Query(`SELECT id,date,concept,amount_cents,currency,tc FROM card_expenses WHERE card_id=? AND voided_at IS NULL ORDER BY date,id`, cardID)
	if err != nil {
		return nil, err
	}
	for expenses.Next() {
		var charge CardCharge
		var amount, rate int64
		if err = expenses.Scan(&charge.ID, &charge.Date, &charge.Concept, &amount, &charge.Currency, &rate); err != nil {
			expenses.Close()
			return nil, err
		}
		end, e := cycleEndForDate(charge.Date, cutDay)
		if e != nil || end.Format("2006-01-02") != cycleEnd {
			continue
		}
		shown, e := money.Convert(money.Money(amount), money.Currency(charge.Currency), money.Currency(displayCurrency), rate)
		if e != nil {
			expenses.Close()
			return nil, e
		}
		charge.Source = "expense"
		charge.AmountCents = int64(shown)
		charge.OriginalAmountCents = amount
		charge.DisplayCurrency = displayCurrency
		charge.TC = rate
		charges = append(charges, charge)
	}
	if err = expenses.Err(); err != nil {
		expenses.Close()
		return nil, err
	}
	expenses.Close()
	sort.SliceStable(charges, func(i, j int) bool { return charges[i].Date < charges[j].Date })
	return charges, nil
}

func (s *CardService) SaveExpense(v CardExpense) (CardExpense, error) {
	db, e := s.core.check()
	if e != nil {
		return v, e
	}
	if v.CardID <= 0 || v.Date == "" || v.Concept == "" {
		return v, fmt.Errorf("cardId, date and concept are required")
	}
	if e = validateDate("date", v.Date); e != nil {
		return v, e
	}
	if errs := validateMoney("amountCents", v.AmountCents, v.Currency, v.TC); len(errs) > 0 {
		return v, validation(errs)
	}
	t := now()
	if v.ID == 0 {
		r, e := db.Exec(`INSERT INTO card_expenses(card_id,date,concept,amount_cents,currency,tc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, v.CardID, v.Date, v.Concept, v.AmountCents, v.Currency, v.TC, t, t)
		if e != nil {
			return v, e
		}
		v.ID, _ = r.LastInsertId()
	} else {
		_, e = db.Exec(`UPDATE card_expenses SET card_id=?,date=?,concept=?,amount_cents=?,currency=?,tc=?,updated_at=? WHERE id=? AND voided_at IS NULL`, v.CardID, v.Date, v.Concept, v.AmountCents, v.Currency, v.TC, t, v.ID)
		if e != nil {
			return v, e
		}
	}
	return v, nil
}
func (s *CardService) ListExpenses(q ListQuery) (Page, error) {
	return s.core.list("cardExpenses", "date", q)
}
func (s *CardService) Cycles(displayCurrency string) ([]CardCycle, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		displayCurrency = "PEN"
	}
	rows, e := db.Query(`SELECT id,name,cut_day,due_day FROM cards WHERE voided_at IS NULL ORDER BY name`)
	if e != nil {
		return nil, e
	}
	type card struct {
		id       int64
		name     string
		cut, due int
	}
	cards := []card{}
	for rows.Next() {
		var c card
		if e = rows.Scan(&c.id, &c.name, &c.cut, &c.due); e != nil {
			rows.Close()
			return nil, e
		}
		cards = append(cards, c)
	}
	rows.Close()
	cycles := map[string]*CardCycle{}
	add := func(cid int64, name, date string, day, due int, amount, rate int64, currency string) error {
		parsed, err := time.Parse("2006-01-02", date)
		if err != nil {
			return err
		}
		month := time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, time.UTC)
		if parsed.Day() > day {
			month = month.AddDate(0, 1, 0)
		}
		end := month.AddDate(0, 1, -1)
		if day < end.Day() {
			end = time.Date(month.Year(), month.Month(), day, 0, 0, 0, 0, time.UTC)
		}
		key := fmt.Sprintf("%d:%s", cid, end.Format("2006-01-02"))
		cycle := cycles[key]
		if cycle == nil {
			dueMonth := month
			if due <= day {
				dueMonth = dueMonth.AddDate(0, 1, 0)
			}
			lastDay := dueMonth.AddDate(0, 1, -1).Day()
			dueDay := due
			if dueDay > lastDay {
				dueDay = lastDay
			}
			dueDate := time.Date(dueMonth.Year(), dueMonth.Month(), dueDay, 0, 0, 0, 0, time.UTC)
			cycle = &CardCycle{CardID: cid, CardName: name, CycleEnd: end.Format("2006-01-02"), DueDate: dueDate.Format("2006-01-02"), Currency: displayCurrency}
			cycles[key] = cycle
		}
		v, err := money.Convert(money.Money(amount), money.Currency(currency), money.Currency(displayCurrency), rate)
		if err != nil {
			return err
		}
		cycle.TotalCents += int64(v)
		return nil
	}
	for _, c := range cards {
		purchases, e := db.Query(`SELECT id,date,currency,tc FROM purchases WHERE card_id=? AND payment_method='card' AND voided_at IS NULL`, c.id)
		if e != nil {
			return nil, e
		}
		type charge struct {
			id, rate       int64
			date, currency string
		}
		charges := []charge{}
		for purchases.Next() {
			var charge charge
			if e = purchases.Scan(&charge.id, &charge.date, &charge.currency, &charge.rate); e != nil {
				purchases.Close()
				return nil, e
			}
			charges = append(charges, charge)
		}
		if e = purchases.Err(); e != nil {
			purchases.Close()
			return nil, e
		}
		purchases.Close()
		for _, charge := range charges {
			var amount int64
			if e = db.QueryRow(`SELECT COALESCE(SUM(qty*unit_cost_cents),0) FROM purchase_items WHERE purchase_id=?`, charge.id).Scan(&amount); e != nil {
				return nil, e
			}
			extraRows, err := db.Query(`SELECT amount_cents,currency FROM purchase_extras WHERE purchase_id=?`, charge.id)
			if err != nil {
				return nil, err
			}
			for extraRows.Next() {
				var extra int64
				var cur string
				if err = extraRows.Scan(&extra, &cur); err != nil {
					extraRows.Close()
					return nil, err
				}
				converted, err := money.Convert(money.Money(extra), money.Currency(cur), money.Currency(charge.currency), charge.rate)
				if err != nil {
					extraRows.Close()
					return nil, err
				}
				amount += int64(converted)
			}
			extraRows.Close()
			if e = add(c.id, c.name, charge.date, c.cut, c.due, amount, charge.rate, charge.currency); e != nil {
				return nil, e
			}
		}
		expenses, err := db.Query(`SELECT date,amount_cents,currency,tc FROM card_expenses WHERE card_id=? AND voided_at IS NULL`, c.id)
		if err != nil {
			return nil, err
		}
		for expenses.Next() {
			var date, currency string
			var amount, rate int64
			if err = expenses.Scan(&date, &amount, &currency, &rate); err != nil {
				expenses.Close()
				return nil, err
			}
			if err = add(c.id, c.name, date, c.cut, c.due, amount, rate, currency); err != nil {
				expenses.Close()
				return nil, err
			}
		}
		expenses.Close()
	}
	for _, cycle := range cycles {
		var paid sql.NullString
		_ = db.QueryRow(`SELECT paid_date FROM card_cycle_payments WHERE card_id=? AND cycle_end=?`, cycle.CardID, cycle.CycleEnd).Scan(&paid)
		if paid.Valid {
			cycle.PaidDate = paid.String
			cycle.Status = "paid"
		} else if today() > cycle.DueDate {
			cycle.Status = "overdue"
		} else if today() > cycle.CycleEnd {
			cycle.Status = "due"
		} else {
			cycle.Status = "open"
		}
	}
	out := make([]CardCycle, 0, len(cycles))
	for _, v := range cycles {
		out = append(out, *v)
	}
	return out, nil
}
func (s *CardService) ListCycles(q ListQuery) (Page, error) {
	cycles, e := s.Cycles(q.DisplayCurrency)
	if e != nil {
		return Page{}, e
	}
	filtered := []CardCycle{}
	for _, cycle := range cycles {
		keep := true
		for _, f := range q.Filters {
			switch f.Field {
			case "card":
				value := fmt.Sprint(f.Value)
				if f.Op == "contains" {
					keep = keep && strings.Contains(strings.ToLower(cycle.CardName), strings.ToLower(value))
				} else if f.Op == "equals" || f.Op == "is" {
					keep = keep && cycle.CardName == value
				} else {
					return Page{}, fmt.Errorf("unsupported card filter operator")
				}
			case "cycleEnd":
				value := fmt.Sprint(f.Value)
				switch f.Op {
				case "inMonth":
					keep = keep && strings.HasPrefix(cycle.CycleEnd, value)
				case "before":
					keep = keep && cycle.CycleEnd < value
				case "after":
					keep = keep && cycle.CycleEnd > value
				case "between":
					keep = keep && cycle.CycleEnd >= value && cycle.CycleEnd <= fmt.Sprint(f.End)
				default:
					return Page{}, fmt.Errorf("unsupported cycle date operator")
				}
			case "total":
				value, ok := numeric(f.Value)
				if !ok {
					return Page{}, fmt.Errorf("total filter must be numeric")
				}
				switch f.Op {
				case "=", "equals":
					keep = keep && cycle.TotalCents == value
				case ">":
					keep = keep && cycle.TotalCents > value
				case "<":
					keep = keep && cycle.TotalCents < value
				case "between":
					end, ok := numeric(f.End)
					if !ok {
						return Page{}, fmt.Errorf("total range endpoint must be numeric")
					}
					keep = keep && cycle.TotalCents >= value && cycle.TotalCents <= end
				default:
					return Page{}, fmt.Errorf("unsupported total operator")
				}
			case "status":
				switch f.Op {
				case "is", "equals":
					keep = keep && cycle.Status == fmt.Sprint(f.Value)
				case "isAny", "in":
					values, ok := f.Value.([]any)
					if !ok || len(values) == 0 {
						return Page{}, fmt.Errorf("status filter requires values")
					}
					match := false
					for _, value := range values {
						match = match || cycle.Status == fmt.Sprint(value)
					}
					keep = keep && match
				default:
					return Page{}, fmt.Errorf("unsupported status operator")
				}
			default:
				return Page{}, fmt.Errorf("unsupported cycle filter field %q", f.Field)
			}
		}
		if keep {
			filtered = append(filtered, cycle)
		}
	}
	groups := map[string]*MonthGroup{}
	months := []string{}
	for _, cycle := range filtered {
		month := cycle.CycleEnd[:7]
		if q.CursorMonth != "" && month >= q.CursorMonth {
			continue
		}
		group := groups[month]
		if group == nil {
			group = &MonthGroup{Month: month, Rows: []map[string]any{}}
			groups[month] = group
			months = append(months, month)
		}
		group.Count++
		group.Total += cycle.TotalCents
		group.Rows = append(group.Rows, map[string]any{"cardId": cycle.CardID, "card": cycle.CardName, "cycleEnd": cycle.CycleEnd, "dueDate": cycle.DueDate, "totalCents": cycle.TotalCents, "currency": cycle.Currency, "paidDate": cycle.PaidDate, "status": cycle.Status})
	}
	sort.Sort(sort.Reverse(sort.StringSlice(months)))
	limit := q.MonthsLimit
	if limit <= 0 {
		limit = 6
	}
	if limit > 120 {
		limit = 120
	}
	page := Page{}
	for i, month := range months {
		if i >= limit {
			break
		}
		page.Months = append(page.Months, *groups[month])
	}
	if len(page.Months) > 0 {
		page.NextCursor = page.Months[len(page.Months)-1].Month
	}
	return page, nil
}
func (s *CardService) GetFilterSchema() []map[string]any { return filterSchema("cardCycles") }
func (s *CardService) MarkCyclePaid(cardID int64, cycleEnd, paidDate string) error {
	db, e := s.core.check()
	if e != nil {
		return e
	}
	if paidDate == "" {
		paidDate = today()
	}
	if e = validateDate("cycleEnd", cycleEnd); e != nil {
		return e
	}
	if e = validateDate("paidDate", paidDate); e != nil {
		return e
	}
	t := now()
	_, e = db.Exec(`INSERT INTO card_cycle_payments(card_id,cycle_end,paid_date,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(card_id,cycle_end) DO UPDATE SET paid_date=excluded.paid_date,updated_at=excluded.updated_at`, cardID, cycleEnd, paidDate, t, t)
	return e
}
func (s *CardService) Debt(displayCurrency string) (int64, error) {
	cycles, e := s.Cycles(displayCurrency)
	if e != nil {
		return 0, e
	}
	var total int64
	for _, c := range cycles {
		if c.Status != "paid" {
			total += c.TotalCents
		}
	}
	return total, nil
}
func (s *CardService) Summaries(displayCurrency string) ([]map[string]any, error) {
	db, e := s.core.check()
	if e != nil {
		return nil, e
	}
	if displayCurrency != "PEN" && displayCurrency != "USD" {
		displayCurrency = "PEN"
	}
	cycles, e := s.Cycles(displayCurrency)
	if e != nil {
		return nil, e
	}
	debt := map[int64]int64{}
	for _, cycle := range cycles {
		if cycle.Status != "paid" {
			debt[cycle.CardID] += cycle.TotalCents
		}
	}
	rows, e := db.Query(`SELECT id,name,last4,limit_cents,limit_currency,limit_tc FROM cards WHERE voided_at IS NULL ORDER BY name`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, tc int64
		var name, last4, currency string
		var limit sql.NullInt64
		if e = rows.Scan(&id, &name, &last4, &limit, &currency, &tc); e != nil {
			return nil, e
		}
		var displayLimit any
		var originalLimit any
		if limit.Valid {
			originalLimit = limit.Int64
			value := money.Money(limit.Int64)
			if currency != displayCurrency {
				converted, err := money.Convert(value, money.Currency(currency), money.Currency(displayCurrency), tc)
				if err != nil {
					return nil, err
				}
				value = converted
			}
			displayLimit = int64(value)
		}
		out = append(out, map[string]any{"id": id, "name": name, "last4": last4, "debtCents": debt[id], "limitCents": displayLimit, "originalLimitCents": originalLimit, "limitCurrency": currency, "limitTc": tc, "currency": displayCurrency})
	}
	return out, rows.Err()
}
func (s *CardService) VoidExpense(id int64) error    { return s.core.void("card_expenses", id, true) }
func (s *CardService) RestoreExpense(id int64) error { return s.core.void("card_expenses", id, false) }
