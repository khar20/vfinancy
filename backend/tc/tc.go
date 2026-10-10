package tc

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"
)

type response struct {
	Rates map[string]float64 `json:"rates"`
}

func Fetch(ctx context.Context) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.er-api.com/v6/latest/USD", nil)
	if err != nil {
		return 0, err
	}
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("exchange rate service returned %s", res.Status)
	}
	var data response
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return 0, err
	}
	rate := data.Rates["PEN"]
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < .5 || rate > 20 {
		return 0, fmt.Errorf("exchange rate response is invalid")
	}
	return int64(math.Round(rate * 10000)), nil
}
