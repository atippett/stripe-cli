-- Connect volume by platform (accounts) from balance_transactions, grouped by display_name and currency
-- merchant_id in balance_transactions relates to accounts.id
-- With --normalize: converts all currencies to USD via exchange_rates_from_usd
-- Placeholders: {{schema}}, {{start_date}}, {{end_date}}, {{limit}}, {{currency_select}}, {{amount_expr}}, {{exchange_join}}, {{currency_group}}, {{order_by}}
SELECT
  a.id AS merchant_id,
  a.display_name AS platform,
  {{currency_select}}
  COUNT(*) AS transaction_count,
  {{amount_expr}}
FROM {{schema}}connected_account_balance_transactions bt
JOIN {{schema}}accounts a ON a.id = bt.merchant_id
{{exchange_join}}
WHERE bt.type = 'charge'
  AND bt.created >= {{start_date}}
  AND bt.created < {{end_date}}
GROUP BY a.id, a.display_name {{currency_group}}
ORDER BY {{order_by}}
LIMIT {{limit}}
