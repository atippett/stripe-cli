-- Connect NET volume by platform (accounts) from charges, grouped by display_name and currency
-- Uses connected_account_charges; volume = amount - amount_refunded; date filter uses captured_at
-- merchant_id relates to accounts.id (platform)
-- With --normalize: converts all currencies to USD via exchange_rates_from_usd
-- Placeholders: {{schema}}, {{start_date}}, {{end_date}}, {{limit}}, {{payment_method_filter}}, {{type_select}}, {{type_group}}, {{currency_select}}, {{amount_expr}}, {{exchange_join}}, {{currency_group}}, {{order_by}}
SELECT
  a.id AS merchant_id,
  a.display_name AS platform,
  {{type_select}}
  {{currency_select}}
  COUNT(*) AS transaction_count,
  {{amount_expr}}
FROM {{schema}}connected_account_charges ch
JOIN {{schema}}accounts a ON a.id = ch.merchant_id
{{exchange_join}}
WHERE ch.status = 'succeeded'
  {{payment_method_filter}}
  AND ch.captured_at >= {{start_date}}
  AND ch.captured_at < {{end_date}}
GROUP BY a.id, a.display_name {{type_group}} {{currency_group}}
ORDER BY {{order_by}}
LIMIT {{limit}}
