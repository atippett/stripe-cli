# Stripe Network Cost Passthrough (IC++) API Specification

**Version**: Private Preview  
**API Version**: `2025-07-30.preview; network_costs_private_preview=v1`  
**Status**: Private Preview for Platforms

## Overview

Network Cost Passthrough (IC++) allows platforms to offer Interchange++ pricing to their connected accounts. This feature enables connected accounts to pay network costs directly while platforms adjust their application fees accordingly.

## Goals

- Complete guide for platforms to offer IC++ pricing to connected accounts
- API specifications for network cost passthrough management
- Reporting details for transaction and plan-level cost analysis
- Support documentation for common customer questions

## End-to-End Process

### Platform Steps
1. **Manage network cost passthrough status** for accounts
2. **Adjust application fees** for IC++ accounts
3. **Provide reports** to connected accounts

### Connected Account Experience
- Pay network costs directly (interchange + scheme fees)
- Receive detailed cost breakdowns
- Access transaction-level and plan-level reports

## API Reference

### 1. Network Cost Passthrough Management

#### 1.A. Set Account as Network Cost Passthrough

**Endpoint**: `POST /v1/pricing_configs/network_costs/schemes`

**Headers**:
```
Stripe-Version: 2025-07-30.preview; network_costs_private_preview=v1
Stripe-Account: acct_1234
```

**Request**:
```bash
curl https://api.stripe.com/v1/pricing_configs/network_costs/schemes \
  -u "sk_live_....:" \
  -H "Stripe-Version: 2025-07-30.preview; network_costs_private_preview=v1" \
  -H "Stripe-Account: acct_1234" \
  -X POST \
  -d enabled=true
```

**Response**:
```json
{
  "id": "pcsch_1RtBMrPGj7LS2ZC4NtVvHirY",
  "object": "pricing_config_scheme",
  "enabled": true,
  "ends_at": null,
  "livemode": true,
  "pricing_config": "network_costs",
  "starts_at": 1754502193
}
```

**Parameters**:
- `enabled` (boolean, required): Set to `true` to enable network cost passthrough
- `starts_at` (integer, optional): Unix timestamp for future activation

**Notes**:
- Only one scheduled scheme allowed at a time
- Schemes are immutable (delete and recreate to modify)
- Immediate activation unless `starts_at` specified

#### 1.B. Unset Account as Network Cost Passthrough

**Request**:
```bash
curl https://api.stripe.com/v1/pricing_configs/network_costs/schemes \
  -u "sk_live_....:" \
  -H "Stripe-Version: 2025-07-30.preview; network_costs_private_preview=v1" \
  -H "Stripe-Account: acct_1234" \
  -X POST \
  -d enabled=false
```

**Response**:
```json
{
  "id": "pcsch_1RtBSlPGj7LS2ZC4P6VEQe8l",
  "object": "pricing_config_scheme",
  "enabled": false,
  "ends_at": null,
  "livemode": true,
  "pricing_config": "network_costs",
  "starts_at": 1754502559
}
```

#### 1.C. View Network Cost Passthrough Status

**Endpoint**: `GET /v1/pricing_configs/network_costs`

**Request**:
```bash
curl https://api.stripe.com/v1/pricing_configs/network_costs \
  -u "sk_live_....:" \
  -H "Stripe-Version: 2025-07-30.preview; network_costs_private_preview=v1" \
  -H "Stripe-Account: acct_1234" \
  -X GET \
  -d "expand[]"="current_scheme" \
  -d "expand[]"="next_scheme"
```

**Response**:
```json
{
  "id": "network_costs",
  "object": "pricing_config",
  "current_scheme": {
    "id": "pcsch_1RtBSlPGj7LS2ZC4P6VEQe8l",
    "object": "pricing_config_scheme",
    "enabled": false,
    "ends_at": 1754614254,
    "livemode": true,
    "pricing_config": "network_costs",
    "starts_at": 1754502559
  },
  "livemode": true,
  "next_scheme": {
    "id": "pcsch_1RtBhkPGj7LS2ZC4U7LWEvLX",
    "object": "pricing_config_scheme",
    "enabled": true,
    "ends_at": null,
    "livemode": true,
    "pricing_config": "network_costs",
    "starts_at": 1754614254
  }
}
```

#### 1.D. Get Scheme at Specific Time

**Endpoint**: `GET /v1/pricing_configs/network_costs/schemes/current_at`

**Request**:
```bash
curl https://api.stripe.com/v1/pricing_configs/network_costs/schemes/current_at \
  -u "sk_live_.." \
  -H "Stripe-Version: 2025-07-30.preview; network_costs_private_preview=v1" \
  -H "Stripe-Account: acct_1234" \
  -X GET \
  -d current_at=1754502879
```

**Response**:
```json
{
  "id": "pcsch_1RtBSlPGj7LS2ZC4P6VEQe8l",
  "object": "pricing_config_scheme",
  "enabled": true,
  "ends_at": 1754503791,
  "livemode": true,
  "pricing_config": "network_costs",
  "starts_at": 1754502879
}
```

#### 1.E. Delete Scheduled Scheme

**Endpoint**: `DELETE /v1/pricing_configs/network_costs/schemes/{scheme_id}`

**Request**:
```bash
curl https://api.stripe.com/v1/pricing_configs/network_costs/schemes/pcsch_1RtBWbPGj7LS2ZC4q5lrEuNG \
  -u "sk_live_..:" \
  -H "Stripe-Version: 2025-07-30.preview; network_costs_private_preview=v1" \
  -H "Stripe-Account: acct_1234" \
  -X DELETE
```

**Response**:
```json
{
  "id": "pcsch_1RtBWbPGj7LS2ZC4q5lrEuNG",
  "deleted": true
}
```

**Error Handling**:
- Cannot delete schemes with `starts_at` in the past (400 error)
- Cannot create multiple scheduled schemes (400 error)

### 2. Application Fee Adjustment

Platforms must adjust application fees for IC++ accounts since they no longer need to recoup network costs.

#### Option 1: Internal Pricing Engine
Update internal logic to charge lower app fees for IC++ accounts.

#### Option 2: Connect Platform Pricing Tools
1. Create pricing group for IC++ CAs
2. Duplicate current pricing scheme
3. Modify card payment pricing rules
4. Assign IC++ CAs to new pricing group

**Pricing Group Management**:
- **CSV Upload**: Bulk add accounts via CSV
- **API**: Programmatic account assignment
- **Pricing Rules**: Lower card payment fees for IC++ accounts

### 3. Reporting API

#### 3.A. IC+ Plan-Level Report

**Endpoint**: `POST /v1/reporting/report_runs`

**Request**:
```bash
curl https://api.stripe.com/v1/reporting/report_runs \
  -u "sk_live...:" \
  -d report_type="connect_card_payments_fees.plan_level.1" \
  -d "parameters[interval_start]"=1680000000 \
  -d "parameters[interval_end]"=1680100000 \
  -H "Stripe-Account: acct_123"
```

**Response**:
```json
{
  "id": "frr_1RmMIdPHHHwdjQjw3kOoBamc",
  "object": "reporting.report_run",
  "created": 1752875919,
  "error": null,
  "livemode": true,
  "parameters": {
    "interval_end": 1680100000,
    "interval_start": 1680000000
  },
  "report_type": "connect_card_payments_fees.plan_level.1",
  "result": {
    "id": "file_1RmM67PHHHwdjQjwvvCB2JwD",
    "object": "file",
    "created": 1752875143,
    "expires_at": 1784411143,
    "filename": "frr_1RmM5wPHHHwdjQjwgfvy9rXJ.csv",
    "links": {
      "object": "list",
      "data": [],
      "has_more": false,
      "url": "/v1/file_links?file=file_1RmM67PHHHwdjQjwvvCB2JwD"
    },
    "purpose": "finance_report_run",
    "size": 464,
    "title": "FinanceReportRun frr_1RmM5wPHHHwdjQjwgfvy9rXJ",
    "type": "csv",
    "url": "https://files.stripe.com/v1/files/file_1RmM67PHHHwdjQjwvvCB2JwD/contents"
  },
  "status": "succeeded",
  "succeeded_at": 1752875919
}
```

**CSV Format**:
```csv
"platform_id","connected_account_id","connected_account_name","plan_name","network_cost_category","total_amount","fee_currency","livemode"
"acct_1GcldzAppfGnVJgH","acct_1PzmZGPHHHwdjQjw",,"All scheme fees","card_scheme","0.005991","usd","true"
"acct_1GcldzAppfGnVJgH","acct_1PzmZGPHHHwdjQjw",,"CPS Services","interchange","0.025750","usd","true"
"acct_1GcldzAppfGnVJgH","acct_1PzmZGPHHHwdjQjw",,"Visa Traditional - Product 1","interchange","0.016175","usd","true"
```

#### 3.B. IC+ Transaction-Level Report

**Request**:
```bash
curl https://api.stripe.com/v1/reporting/report_runs \
  -u "sk_live..:" \
  -d report_type="connect_card_payments_fees.transaction_level.1" \
  -d "parameters[interval_start]"=1680000000 \
  -d "parameters[interval_end]"=1680100000 \
  -H "Stripe-Account: acct_123"
```

**CSV Format**:
```csv
"platform_id","connected_account_id","connected_account_name","transfer_id","transfer_created","balance_transaction_id","balance_transaction_created","automatic_payout_id","fee_incurred_at","charge_id","captured_amount","captured_currency","refund_id","dispute_id","card_brand","bin","issuing_bank","card_funding","card_country","card_present","fee_category","card_scheme_fee","interchange_fee","non_transactional_card_scheme_fee","discount_fee","platform_application_fee","total_amount","fee_currency","livemode"
```

#### 3.C. Report Processing

**Event Listener Pattern**:
```json
{
  "id": "evt_1RtCRKPHHHwdjQjwfRPzuvep",
  "object": "event",
  "account": "acct_1234",
  "api_version": "2025-07-30.preview; network_costs_private_preview=v1",
  "context": "acct_1234",
  "created": 1754506314,
  "data": {
    "object": {
      "id": "frr_1RmMIdPHHHwdjQjw3kOoBamc",
      "object": "reporting.report_run",
      "status": "succeeded",
      "succeeded_at": 1754506314
    }
  },
  "type": "reporting.report_run.succeeded"
}
```

**Report Retrieval**:
```bash
curl https://files.stripe.com/v1/files/file_1RmM67PHHHwdjQjwvvCB2JwD/contents \
  -H "Stripe-Account: acct_123" \
  -u sk_live..:
```

## Support Documentation

### Common Customer Questions

| Question | Solution |
|----------|----------|
| How much network costs for charge `ch_...`? | Download IC+ transaction report, filter by `charge_id`, sum `subtotal_network_costs_amount` |
| Total network costs for June 2025? | IC+ plan report: sum `subtotal_amount` column |
| Why did network costs change after download? | Adjustments, refunds, disputes create new rows in transaction report |
| Why different network costs for similar charges? | Check card funding, country, presence in transaction report |
| Network costs without `charge_id`? | Non-transactional scheme fees (Visa FANF, Mastercard MLF) |
| Specific balance transaction amount? | Filter transaction report by `balance_transaction_id` |
| Refund impact on network costs? | Look for multiple rows with same `charge_id`, different `refund_id` |
| Chargeback network cost refund? | Check dispute rows - interchange refunded, scheme fees may not be |

### Support Recommendations

1. **Report Access**: Provide IC+ reports to support team via internal tools or CA dashboard access
2. **Training**: Train support on report interpretation and common scenarios
3. **Documentation**: Maintain internal FAQ based on customer questions

## Platform Operations

### Financial Reports
- Network costs appear in existing Activity and Balance reports
- Platform can track network cost recouping from CA accounts
- All existing reporting remains available

### Reconciliation
- IC+ reports provide detailed fee breakdown regardless of settlement timing
- Consider delaying payouts 3+ days to include network costs in same settlement
- Use transaction reports for detailed reconciliation

## FAQ

### General
**Q: Do CAs have dashboard access to reports?**  
A: Not in private preview. Expected end of 2025.

**Q: Embedded reporting component available?**  
A: Not in private preview. Expected end of 2025.

**Q: Network cost adjustment cut-off?**  
A: No cut-off. All network adjustments will be recouped from CAs.

**Q: Access to detailed network costs without showing CAs?**  
A: Yes. All existing reports remain available with full network cost details.

**Q: Must offer both reports to CAs?**  
A: No. Choose which reports to offer and which for internal support.

**Q: Stripe fees included in network cost recouping?**  
A: No. Only network costs (interchange, scheme). Include other Stripe fees in application fees.

**Q: Multi-CA consolidated reports?**  
A: Not available. Single CA per report. Considering scaling options for post-preview.

## Implementation Checklist

### Platform Setup
- [ ] Integrate pricing scheme management API
- [ ] Update application fee logic for IC++ accounts
- [ ] Implement reporting API integration
- [ ] Set up event listeners for report completion
- [ ] Train support team on IC++ reports
- [ ] Update internal documentation

### Testing
- [ ] Test scheme creation/deletion
- [ ] Verify application fee adjustments
- [ ] Test report generation and retrieval
- [ ] Validate event handling
- [ ] Test error scenarios

### Go-Live
- [ ] Enable IC++ for test accounts
- [ ] Monitor report generation
- [ ] Verify fee adjustments
- [ ] Train support team
- [ ] Document customer communication

## Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| 400 | Multiple scheduled schemes | Delete existing scheme before creating new one |
| 400 | Delete past scheme | Cannot delete schemes with past `starts_at` |
| 400 | Invalid `current_at` | `current_at` must be after account creation |
| 401 | Invalid API key | Verify API key permissions |
| 403 | Insufficient permissions | Ensure API key has required scopes |

## Rate Limits

- Standard Stripe API rate limits apply
- Report generation: ~minutes per report
- Use event listeners for async report processing
- Consider caching for frequently accessed reports

## Security Considerations

- API keys must have appropriate permissions
- Reports contain sensitive financial data
- Implement proper access controls for report access
- Consider data retention policies for downloaded reports

