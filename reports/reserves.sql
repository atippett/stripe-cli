-- Reserve balance: starting balance (from summarized) + period activity = ending balance
-- Uses summarized_balance_transactions for starting balance at day before period
-- Uses balance_transactions for period activity (reserve_hold, reserve_release, reserved_funds, reserve_transaction)
--
-- summarized_balance_transactions: daily snapshots. Schema follows Balance API:
--   date, merchant_id, currency, connect_reserved (amount in cents), available, pending, etc.
-- See https://docs.stripe.com/api/balance/balance_object
--
-- Placeholders: {{schema}}, {{start_date}}, {{start_date_prev}}, {{end_date}}, {{limit}}
WITH starting AS (
  SELECT
    s.merchant_id,
    s.currency,
    COALESCE(SUM(s.connect_reserved), 0) / 100.0 AS starting_balance
  FROM {{schema}}summarized_balance_transactions s
  WHERE s.date = {{start_date_prev}}
  GROUP BY s.merchant_id, s.currency
),
activity AS (
  SELECT
    bt.merchant_id,
    bt.currency,
    COUNT(*) AS transaction_count,
    SUM(bt.amount) / 100.0 AS period_activity
  FROM {{schema}}balance_transactions bt
  WHERE bt.type IN ('reserve_hold', 'reserve_release', 'reserved_funds', 'reserve_transaction')
    AND bt.created >= {{start_date}}
    AND bt.created < {{end_date}}
  GROUP BY bt.merchant_id, bt.currency
),
combined AS (
  SELECT
    COALESCE(a.merchant_id, s.merchant_id) AS merchant_id,
    COALESCE(a.currency, s.currency) AS currency,
    COALESCE(a.transaction_count, 0) AS transaction_count,
    COALESCE(s.starting_balance, 0) AS starting_balance,
    COALESCE(a.period_activity, 0) AS period_activity,
    COALESCE(s.starting_balance, 0) + COALESCE(a.period_activity, 0) AS ending_balance
  FROM starting s
  FULL OUTER JOIN activity a ON a.merchant_id = s.merchant_id AND (a.currency = s.currency OR (a.currency IS NULL AND s.currency IS NULL))
)
SELECT
  c.merchant_id,
  COALESCE(ac.display_name, c.merchant_id) AS platform,
  c.currency,
  c.transaction_count,
  c.starting_balance,
  c.period_activity,
  c.ending_balance
FROM combined c
LEFT JOIN {{schema}}accounts ac ON ac.id = c.merchant_id
ORDER BY platform, c.currency
LIMIT {{limit}}
