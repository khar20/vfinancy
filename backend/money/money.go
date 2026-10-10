package money

import "fmt"

type Money int64
type Currency string

const (
	PEN Currency = "PEN"
	USD Currency = "USD"
	Max Money    = 9_999_999_999
)

func (c Currency) Valid() bool { return c == PEN || c == USD }

func Convert(amount Money, from, to Currency, tc int64) (Money, error) {
	if !from.Valid() || !to.Valid() {
		return 0, fmt.Errorf("currency must be PEN or USD")
	}
	if tc < 5000 || tc > 200000 {
		return 0, fmt.Errorf("exchange rate must be between 0.5000 and 20.0000")
	}
	if amount > Max || amount < -Max {
		return 0, fmt.Errorf("amount exceeds supported limit")
	}
	if from == to {
		return amount, nil
	}
	var n, d int64
	if from == USD {
		n, d = tc, 10000
	} else {
		n, d = 10000, tc
	}
	if amount != 0 && (amount > 0 && int64(amount) > (1<<63-1)/n || amount < 0 && int64(amount) < (-1<<63)/n) {
		return 0, fmt.Errorf("conversion overflow")
	}
	v := int64(amount) * n
	if v >= 0 {
		v = (v + d/2) / d
	} else {
		v = (v - d/2) / d
	}
	if v > int64(Max) || v < -int64(Max) {
		return 0, fmt.Errorf("converted amount exceeds supported limit")
	}
	return Money(v), nil
}
