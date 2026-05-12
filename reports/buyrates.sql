-- Min / median / max fee (buy rate) per product/feature and currency from itemized_fees for a time window.
-- usd fx: units of row currency per 1 USD from exchange_rates_from_usd on {{fx_rate_date}} (day before exclusive end_date).
-- Output: feature_key (CLI join; stripped), product + currency from warehouse; CLI merges into Product (cc) (no currency column), median, max, min, amount, and:
-- median, max, min, amount (sum of fee lines for period), usd fx, count. CLI inserts buyrate / usd fx / buyrate fx / median / vs median after dropping currency, est. savings after amount, then note last (= amount − buyrate fx × count; see pipeline.js).
-- Min/max/median stay in row currency; buyrate fx from config is USD-comparable via usd fx where applicable.
-- Median: APPROXIMATE PERCENTILE_DISC(0.5) (Redshift) — much faster than exact PERCENTILE_CONT on large
-- itemized_fees windows; ~sub-percent typical error. For exact median, replace with PERCENTILE_CONT(0.5).
-- Per feature: USD row first, then other currencies; **product** repeats the feature label on **every** currency row.
-- Stripe Data Pipeline uses product_feature_description for the feature label; first-row label column is `product`.
-- If your warehouse column is literally feature_name, replace product_feature_description below.
-- Amount is in major currency units per Stripe docs (not cents).
--
-- Date filter column: {{buyrates_date_col}} (default activity_at; override via config buyrates_date_column or
-- --buyrates-date-column, e.g. incurred_at or balance_transaction_created).
-- See https://docs.stripe.com/stripe-data/query-all-fees-data
--
-- Placeholders: {{schema}}, {{start_date}}, {{end_date}}, {{limit}}, {{buyrates_date_col}}, {{fx_rate_date}}
WITH base AS (
  SELECT
    COALESCE(NULLIF(TRIM(f.product_feature_description), ''), '(empty)') AS feature_key,
    f.currency,
    MAX(
      CASE
        WHEN LOWER(TRIM(f.currency)) = 'usd' THEN CAST(1 AS DECIMAL(38, 18))
        ELSE CAST(NULLIF(JSON_EXTRACT_PATH_TEXT(er.buy_currency_exchange_rates, f.currency), '') AS DECIMAL(38, 18))
      END
    ) AS fx,
    APPROXIMATE PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY f.amount) AS "median",
    MAX(f.amount) AS "max",
    MIN(f.amount) AS "min",
    SUM(f.amount) AS "amount",
    COUNT(*) AS "count"
  FROM {{schema}}itemized_fees f
  LEFT JOIN {{schema}}exchange_rates_from_usd er
    ON er.date = {{fx_rate_date}}
  WHERE f.{{buyrates_date_col}} >= {{start_date}}
    AND f.{{buyrates_date_col}} < {{end_date}}
  GROUP BY COALESCE(NULLIF(TRIM(f.product_feature_description), ''), '(empty)'), f.currency
),
ordered AS (
  SELECT
    feature_key,
    currency,
    "median",
    "max",
    "min",
    "amount",
    fx,
    "count",
    ROW_NUMBER() OVER (
      PARTITION BY feature_key
      ORDER BY CASE WHEN LOWER(TRIM(currency)) = 'usd' THEN 0 ELSE 1 END, currency
    ) AS rn
  FROM base
)
SELECT
  feature_key,
  feature_key AS product,
  currency,
  "median",
  "max",
  "min",
  "amount",
  fx AS "usd fx",
  "count"
FROM ordered
ORDER BY feature_key, CASE WHEN LOWER(TRIM(currency)) = 'usd' THEN 0 ELSE 1 END, currency
LIMIT {{limit}}
