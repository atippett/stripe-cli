# AGENTS.md

A CLI tool for making Stripe API calls, starting with Connect account management.

## Project Overview

This is a Node.js CLI tool built with Commander.js that provides a command-line interface for Stripe API operations. The current implementation focuses on Connect account management, with plans to expand to other Stripe API endpoints.

## Setup Commands

- Install dependencies: `npm install`
- Make CLI executable: `chmod +x bin/stripe-cli`
- Test CLI help: `node bin/stripe-cli --help`

## Development Environment

- Node.js 14.0.0 or higher required
- Uses npm for package management
- No build step required - direct Node.js execution
- CLI entry point: `bin/stripe-cli`

## Code Style

- Use CommonJS modules (require/module.exports)
- Single quotes for strings
- 2-space indentation
- Descriptive variable and function names
- Comprehensive error handling with user-friendly messages
- Use async/await for asynchronous operations

## Project Structure

```
stripe-cli/
├── bin/
│   └── stripe-cli              # CLI entry point: registers all commands via Commander
├── lib/
│   ├── commands/
│   │   ├── account.js          # account.list, account.search, account.link
│   │   ├── account-settings.js # account.setting.network-cost.* (passthrough)
│   │   ├── capabilities.js     # account.capabilities.*
│   │   ├── cards.js            # account.import.card (CSV → SetupIntents)
│   │   ├── checkout.js         # checkout.session.setup
│   │   ├── customer.js         # account.customer.delete (by id/metadata/all)
│   │   ├── hardware.js         # hardware.list, hardware.catalog
│   │   ├── migrate-cards.js    # migrate.card.map (CardConnect ↔ Stripe outer join, offline)
│   │   ├── pipeline.js         # pipeline.query, pipeline.report (Redshift via pg)
│   │   └── test-account.js     # test.account.generate (uses kyc.yml)
│   ├── config-loader.js        # Loads config.yml; resolves required key type per command
│   ├── profile-manager.js      # Parses .secrets ini-style profiles
│   └── stripe-client.js        # Builds Stripe client; getStripeKey() resolves --key/-p/env
├── reports/                    # Canned pipeline SQL (*.sql) — supports {{placeholders}}
├── config.yml                  # Platforms, command key requirements, pipeline config
├── kyc.yml                     # Per-country test data for test.account.generate
├── __tests__/                  # Jest unit + integration tests
├── jest.config.js              # Jest projects: unit, integration
└── package.json
```

## High-Level Architecture

`bin/stripe-cli` is a thin Commander dispatcher; each subcommand handler lives in `lib/commands/*.js`. Two cross-cutting concerns to know:

1. **Key resolution (`lib/stripe-client.js#getStripeKey`)** — Priority: `--key` > `--platform` (from `.secrets`) > default profile (from `config.yml#global.default_platform`) > `STRIPE_SECRET_KEY` env. The required key type (`secret` vs `restricted`) is looked up per command path via `config-loader.js#getRequiredKeyType`. Platforms ending `-uat`/`-test` flip the resolver to test mode and fall back to the base platform's test keys if the UAT profile is missing one.
2. **Two configuration files**:
   - `.secrets` (ini, `chmod 600`-enforced by `profile-manager.js`) — API keys per profile.
   - `config.yml` — platform → account/connected_account map; per-command required key types; `commands.pipeline` host/schema/buyrates settings.

The pipeline command (`lib/commands/pipeline.js`) is the most complex: it runs SQL against Stripe Data Pipeline Redshift via `pg`, renders shared table/JSON/CSV output (used by both `pipeline.query` and `pipeline.report`), and resolves canned reports from `reports/*.sql` with `{{schema}}`/`{{start_date}}`/`{{end_date}}`/etc. placeholders. When adding a new report, also extend `getReportDataLoadTimeTables()` so the freshness footer lists the right tables, and add any new numeric column names to `numericColPattern` to keep alignment consistent.

## Keeping README.md in sync

**Whenever you add, change, or remove CLI commands or behavior, update README.md in the same change.**

- **Commands** – Adding or changing anything in `bin/stripe-cli` (new commands, new options, renamed commands) → update the relevant section and examples in README.md.
- **Behavior** – Changing behavior in `lib/commands/` (e.g. new flags, output format, prompts) → update README.md so usage, options, and examples match.
- **Config** – Changing how `config.yml` or `.secrets` is used → update the Configuration section in README.md.

Do not wait for the user to ask; treat README updates as part of the same task when you modify the CLI.

## Keeping AGENTS.md in sync

**Whenever you add or change material product requirements, update AGENTS.md in the same change.**

- **New features** – Document setup, configuration, usage, and conventions in the relevant section.
- **Behavior changes** – Update existing sections so they reflect current behavior.
- **New commands or config** – Add to the appropriate subsection (Platform Commands, Pipeline, etc.).

Do not wait for the user to ask; treat AGENTS.md updates as part of the same task when requirements change.

## Testing Instructions

Jest is configured with two projects (`unit`, `integration`) — see `jest.config.js`.

- `npm test` – Run all tests
- `npm run test:unit` – Unit tests only (fast; no network)
- `npm run test:integration` – Integration tests (uses `nock` to mock Stripe; see `INTEGRATION_TESTING.md`)
- `npm run test:watch` – Watch mode
- `npm run test:coverage` – With coverage report
- Run a single test file: `npx jest __tests__/cards.test.js`
- Run a single test by name: `npx jest -t "imports cards from CSV"`

Smoke checks that don't require keys:

- `node bin/stripe-cli --help`
- `node bin/stripe-cli pipeline.report --help`
- `node bin/stripe-cli account.list --key invalid_key` (verifies error path)

## API Key Configuration

- Supports both secret keys (`sk_`) and restricted keys (`rk_`)
- Multiple configuration methods with priority order:
  1. `--key` option (highest priority)
  2. `--platform` option
  3. Default platform from `config.yml` file
  4. `STRIPE_SECRET_KEY` environment variable (lowest priority)
- Profile management via `.secrets` configuration file
- Validation ensures keys start with `sk_` or `rk_`
- Clear error messages for authentication issues

### Profile Configuration

Create a `.secrets` file in the project root (must be `chmod 600` — `profile-manager.js` enforces this on Unix). Use **separate sections** for prod and UAT/test, with the same key names in each:

```ini
[vet]
public_key=pk_live_...
restricted_key=rk_live_...
secret_key=sk_live_...

[vet-uat]
public_key=pk_test_...
restricted_key=rk_test_...
secret_key=sk_test_...

[daysmart]
restricted_key=rk_live_...

[daysmart-uat]
restricted_key=rk_test_...
secret_key=sk_test_...
```

Platform names ending with `-uat` or `-test` resolve to test mode; if a UAT profile is missing the required key type, `getStripeKey` falls back to the base profile's test keys. The legacy `test_*_key` style (combined prod+test in one section) is still parsed but new profiles should use dedicated `-uat` sections.

And configure platforms in `config.yml`:

```yaml
global:
  default_platform: "vet"
  test_platform: "vet"

platform:
  vet:
    account: "acct_18yYltEdgy9m3MPr"
    connected_account: "acct_1MzSRtROT734hn6m"
  vet-uat:
    connected_account: "acct_1Rw31tRLzvnMBwNL"
  daysmart:
    account: "acct_1LLF4ZFUW1wgLnXK"
  daysmart-uat:
    account: "acct_1LLF4ZFUW1wgLnXK"
    connected_account: "acct_1MMHptFa2mkwl760"
```

Each platform entry can have a single `connected_account`. Platform names ending with `-uat` or `-test` use test mode. UAT entries without `account` inherit from the base platform (e.g. `vet-uat` uses `vet`'s account).

### Platform Commands

- `stripe-cli config.platform.list` - List all configured platforms and their settings
- `stripe-cli account.list -p vet` - Use specific platform
- `stripe-cli account.list` - Use default platform
- `stripe-cli account.search "veterinary"` - Search accounts with fuzzy matching
- `stripe-cli account.search "*vet*"` - Search with wildcards
- `stripe-cli account.link -p vet` - Create Stripe account link for Connect onboarding (uses profile’s account from config.yml); or `-a acct_123`; optional `--type`, `--refresh-url`, `--return-url`, `--collection-fields`, `--collection-future-requirements`

### Account Settings Commands

- `stripe-cli account.setting.network-cost.enable -a acct_123` - Enable network cost passthrough
- `stripe-cli account.setting.network-cost.disable -a acct_123` - Disable network cost passthrough
- `stripe-cli account.setting.network-cost.status -a acct_123` - Check network cost passthrough status
- `stripe-cli account.setting.network-cost.delete-scheme -a acct_123 --scheme-id pcsch_123` - Delete scheduled scheme

### Card Import Commands

- `stripe-cli account.import.card -f cards.csv -a acct_123` - Import card data from CSV to connected account
- `stripe-cli account.import.card -f cards.csv -a acct_123 --dry-run` - Validate CSV without creating cards
- `stripe-cli account.import.card -f cards.csv -a acct_123 --verbose` - Import with detailed progress output
- `stripe-cli account.import.card -f cards.csv -a acct_123 --delimiter ";"` - Use custom CSV delimiter
- `stripe-cli account.import.card -f cards.csv -a acct_123 --limit 10` - Import only first 10 cards
- `stripe-cli account.import.card -f cards.csv -a acct_123 --concurrency 10` - Import with higher concurrency (faster for large files)

#### CSV Format Requirements

The card import command expects a CSV file with the following format:
```csv
card,exp,first,last,zip,token
4242424242424242,12/25,John,Doe,12345,tok_1234567890abcdef
```

**Required columns (in order):**
- `card`: Card number (13-19 digits, no spaces/dashes) - **Required**
- `exp`: Expiration date (MM/YY or MMYY format) - **Required**
- `first`: Cardholder first name - **Optional**
- `last`: Cardholder last name - **Optional**
- `zip`: Billing ZIP/postal code - **Optional**
- `token`: Card token from 3rd party processor - **Optional**

### Card Migration Commands

`migrate.card.map <connected_account> --cardconnect <file> --stripe <file>` produces a unified mapping between a CardConnect export and a Stripe migration result CSV. It is an **offline full outer join** on `(profileid==old_id, last4, expiry_month, expiry_year)` — no Stripe API calls, no `-p`/`-k` needed.

- **Inputs:**
  - `--cardconnect <file>`: CardConnect export (per-card rows). Required columns: `profileid`, `token`, `expiry`. Card last4 is derived from the last 4 digits of `token`, so no-PAN exports work.
  - `--stripe <file>`: Stripe migration result CSV (the file Stripe returns after running a card PM import). Required columns: `old_id`, `created_customer`, `source_new_id`, `card_last4`, `card_exp_month`, `card_exp_year`.
  - `<connected_account>`: Stripe connected account ID (`acct_*`) — validated, emitted as a `stripe_connected_account` column for traceability.
- **Output (stdout, CSV by default):** `match_status` (`matched` | `cardconnect_only` | `stripe_only`), `stripe_connected_account`, then all CardConnect columns, then all Stripe columns. Card numbers in `card` / `card number` columns are masked. Summary counts (matched / cardconnect_only / stripe_only) go to stderr.
- **Why prefer this over hitting the API:** the Stripe migration result is the **authoritative snapshot at import time** — cards replaced or removed after the import don't cause false-negative card matches. Live-API matching produced 6 spurious `unmatched_card` rows that the offline join correctly resolves.

### Test Account Generation Commands

- `stripe-cli test.account.generate -p ttp --environment test` - Generate test connected accounts for all configured countries in kyc.yml with card_payments and transfers capabilities and all KYC/KYB requirements filled in
- `stripe-cli test.account.generate -p ttp --test` - Use test environment (alternative to --environment test)
- `stripe-cli test.account.generate --format json` - Output results in JSON format

#### Test Data Configuration

The `test.account.generate` command loads test data from the `kyc.yml` configuration file in the project root. This file contains all KYC/KYB test data requirements for creating accounts, making it easy to update test values without modifying code.

**Configuration File**: `kyc.yml`

The configuration file uses Stripe's official test tokens to ensure successful verification. These tokens are documented in [Stripe's Testing Guide](https://docs.stripe.com/connect/testing):

**Test Values Used:**
- **Business Type**: `individual` - Creates individual accounts (sole proprietors)
- **Date of Birth**: `1901-01-01` - Successful date of birth match (any other DOB results in no-match)
- **Address line1**: `address_full_match` - Successful address match (enables both charges and payouts)
- **SSN Last 4 (US)**: `0000` - Successful ID number match
- **Phone Numbers**: `0000000000` - Successful phone number validation
- **Bank Accounts**: 
  - US: Routing `110000000`, Account `000123456789` (test payout account)
  - Canada: Routing `11000-000`, Account `000123456789` (test payout account)

**Important Notes:**
- All test data uses Stripe's official test tokens for reliable verification
- Test accounts are created with `business_type: 'individual'` and both `card_payments` and `transfers` capabilities requested (transfers is required when using card_payments)
- The command creates accounts for all countries defined in `kyc.yml` (currently supports 42 countries)
- Each country has its own configuration with appropriate test data (names, addresses, currencies, etc.)
- Both Canadian (CA) and US accounts are created with full KYC information
- Capabilities may take a few moments to activate after KYC/KYB verification
- These test tokens only work in test mode with test API keys

**Reference Documentation:**
- [Stripe Connect Testing Guide](https://docs.stripe.com/connect/testing) - Complete guide to testing Stripe Connect
- [Test Dates of Birth](https://docs.stripe.com/connect/testing#test-dates-of-birth) - DOB tokens for verification
- [Test Addresses](https://docs.stripe.com/connect/testing#test-addresses) - Address tokens for verification
- [Test Personal ID Numbers](https://docs.stripe.com/connect/testing#test-personal-id-numbers) - ID number tokens
- [Test Phone Numbers](https://docs.stripe.com/connect/testing#test-phone-number-validation) - Phone validation tokens

## Pipeline (Stripe Data Pipeline → Redshift)

The pipeline command connects to a Stripe Data Pipeline Redshift database and runs SQL queries.

### Schema Reference

- **Schema documentation**: [Stripe data schema](https://docs.stripe.com/stripe-data/schema) – full schema with tables, columns, and relationships

### Database Schemas

Stripe Data Pipeline splits data into two schemas by API mode:

| Schema | Description |
|--------|-------------|
| `STRIPE` | Live mode (production) data |
| `STRIPE_TESTMODE` | Test mode and sandbox data |

Every table includes a `merchant_id` column for filtering when sharing from multiple Stripe accounts.

### Key Datasets and Tables

| Dataset | Table Name | Description |
|---------|------------|-------------|
| `payments` | `charges` | Payment charges |
| `payments` | `balance_transactions` | Balance changes (canonical record) |
| `payments` | `refunds` | Refunds |
| `payments` | `payment_intents` | Payment intents |
| `payments` | `disputes` | Disputes |
| `customers` | `customers` | Customer records |
| `billing` | `subscriptions` | Subscriptions |
| `billing` | `invoices` | Invoices |
| `billing` | `products` | Products |
| `billing` | `prices` | Prices |
| `connect` | `accounts` | Connect accounts |
| `checkout` | `checkout_sessions` | Checkout sessions |
| `transfers` | `transfers` | Transfers |

See [Data freshness](https://docs.stripe.com/stripe-data/available-data) for the full table list and refresh schedules.

### Pipeline Commands

- `stripe-cli pipeline.query -q "SELECT 1"` – Run inline SQL
- `stripe-cli pipeline.query -f query.sql` – Run SQL from file
- `stripe-cli pipeline.report connect_volume` – NET volume from connected_account_charges (amount - amount_refunded, succeeded only)
- `stripe-cli pipeline.report connect_balance_transactions` – Volume from connected_account_balance_transactions
- `stripe-cli pipeline.report reserves` – Reserve balance: starting (from summarized_balance_transactions) + period activity = ending. Uses balance_transactions + summarized_balance_transactions
- `stripe-cli pipeline.report buyrates` – `itemized_fees` + **`exchange_rates_from_usd`**. **`buyrate`**: config value for that **`currency`** (or scalar); **not** derived from **`usd`** alone. **`buyrate fx`** is **`buyrate` ÷ `usd fx`** when **`buyrate`** set; else non-**`usd`** row with nested **`usd`** only → **`usd` × `usd fx`** (compare to **`median`**). **`vs median`**: **100 × (median − buyrate fx) ÷ buyrate fx** — median **over (+)** / **under (−)** target (**`nil`** if missing or **buyrate fx** **0**). **`display: false`** on a fee entry (**`{ display: false }`**, optionally with **`usd`/`gbp`**) omits that fee from the table. **`highlight: true`** on a fee entry prefixes the **Product** column with **`buyrates_highlight_prefix`** (default Unicode **⚠** ); that column’s tint matches **`vs median`** (green / blue / red) when that % is present, else **yellow** for highlighted rows (table only); per-fee **`highlight_prefix`** / **`highlight_icon`**. Table/JSON **`product`** is **`Feature name (cc)`** (lowercase ISO code); no **`currency`** column. Optional **`group: "Section"`** on a fee object: table inserts a **full-row header** (**Product** = group name in **cyan bold**, other cells blank), then every fee with that **`group`**. If **`group`** is omitted (scalar entry, object without **`group`**, or fee not in config), rows use **`Core`**. Section order: **alphabetical** by group name; within a section, rows sort by feature key and **USD** first. Config: **`buyrates_fees`** / **`buyrates_fee_usd`**, scalar or **`{ usd: n, gbp: n, … }`**. Keys match **`product_feature_description`** (trim + collapse internal whitespace). Columns: **`product`** (**Product**); **`buyrate`**, **`usd fx`**, **`buyrate fx`**, **`median`**, **`vs median`**, **`max`**, **`min`**, **`amount`**, **`est. savings`** (**`amount` − `buyrate fx` × `count`**), **`count`**, **`note`** (**center**). **`median`** is **`APPROXIMATE PERCENTILE_DISC(0.5)`** in SQL; min/max/count exact. Per feature **`usd`** then other currencies. Date filter: default **`activity_at`**; override with **`buyrates_date_column`** / **`--buyrates-date-column`**. **Default period = prior calendar month** (no `--period` / `--days`). Also `--period prior_month` (aliases `prev_month`, `lastmonth`)
- `stripe-cli pipeline.report connect_volume --period mtd` – Month to date
- `stripe-cli pipeline.report connect_volume --period yesterday` – Yesterday only
- `stripe-cli pipeline.report connect_volume --period 2025-01-01..2025-01-31` – Date range
- `stripe-cli pipeline.report buyrates --period 2026-02` – Full calendar month (**YYYY-MM**)
- `stripe-cli pipeline.report connect_volume --period last7 --normalize` – Last 7 days, USD normalized
- `stripe-cli pipeline.report reserves --period last12m` – Last 12 months (also last6m, last3m)
- `stripe-cli pipeline.report connect_volume` – All payment methods aggregated (default, no filter)
- `stripe-cli pipeline.report connect_volume --type card` – Card volume only. Use `--type us_bank_account` for ACH
- `stripe-cli pipeline.report connect_volume --type all` – All payment methods, grouped by type (adds `type` column)
- `stripe-cli pipeline.report` (no name) – List available reports (same as `pipeline.report.list`)
- `stripe-cli pipeline.report.list` – List available reports

After each canned report (human-readable **table** output; not **`--format json`** or **`csv`**), the CLI queries Stripe’s `data_load_times` table for the datasets used by that report and prints a **Data freshness** footer (`loaded` timestamps). See [Data freshness](https://docs.stripe.com/stripe-data/available-data). Use `--skip-data-load-times` to skip; set `data_load_times_schema` in `config.yml` or `--data-load-times-schema` if that table lives outside the report schema. **`pipeline.query`** / **`pipeline.report`**: `-o, --format` is **table** (default), **json**, or **csv** (CSV: header row, escaped fields; buyrates omits internal `_buyrates_*` keys like JSON).

With `--period mtd`, volume reports (`connect_volume`, `connect_balance_transactions`) print an extra gray line: summed MTD `volume`/`volume_usd`, **DOW-adjusted** projected month-end (prior Mon–Sun UTC week’s volume by weekday applied to each remaining month day), plus a **linear** reference, and the stalest `data_load_times.loaded` when freshness was not skipped. If the prior-week query fails, the line falls back to linear only.

Canned reports live in `reports/*.sql` and support `{{days}}`, `{{limit}}`, `{{schema}}` placeholders. When adding a report, extend `getReportDataLoadTimeTables()` in `lib/commands/pipeline.js` so the freshness footer lists the correct underlying tables.

### Report Output Formatting

All pipeline reports (canned and ad-hoc) use the same table rendering in `lib/commands/pipeline.js` (`runPipelineQuery`). New reports in `reports/*.sql` inherit this automatically.

**Conventions:**
- **Money columns** (volume, amount, fee, total, sum, net): Right-aligned, always 2 decimals (e.g. `46,075,426.00`). **`buyrates`** table (column order): **`buyrate`**, **`usd fx`**, **`buyrate fx`**, **`median`**, **`vs median`**, **`max`**, **`min`**, **`amount`**, **`est. savings`**, **`count`**, **`note`** — **`buyrate`**, **`buyrate fx`**, **`median`**, **`max`**, and **`min`** use **3** decimals where applicable; **`buyrate fx`** is **half-up** rounded to **3** dp after compute and that same value drives **`vs median`**; SQL parses **`usd fx`** from JSON as **`DECIMAL(38,18)`** (not float) to preserve rate precision; **`amount`** (period sum of fee lines) is **rounded to the nearest integer** (no cents in table); **`est. savings`** is a **rounded integer** (**`amount` − `buyrate fx` × `count`**, half-up; table and JSON); **`vs median`** table cell is **rounded integer + `%`**; **`usd fx`** at least **3** (up to 8); **`count`** integer.
- **Count columns** (`_count`): Right-aligned, integer formatting.
- **Text columns**: Left-aligned. **`buyrates`**: **`note`** (last column; **center** in table; config **`note:`**). When **`vs median`** rounds to **0%**, **`note`** is **`ok`** in **green** (table), or **`ok ·`** + config note if both apply. Whole-word **`good`** / **`bad`** in **`note`** are **green** / **red** (table only; JSON unstyled). **`buyrates`**: synthetic **`group`** header rows (**Product** only; **cyan bold**). **`buyrates`** data rows: **Product** is prefixed with **two spaces** in **table** output only (indent under the group header; JSON **product** unchanged).
- **Total row**: Sum of numeric columns shown at bottom; "Total" label in last non-numeric column.
- **Row count**: Shown after the table in gray.
- **Data freshness**: After reports, gray footer from `data_load_times` (Stripe Data Pipeline).
- **Blank table cells** (`pipeline.query` / `pipeline.report` table output): shown as gray **`nil`** (not in JSON/CSV). **`buyrates`** **`vs median`** (table): **green** when ~**0**, **blue** when negative, **red** when positive. **`buyrates`** **Product** uses the **same** tint as **`vs median`** when the % is present; label is **`Name (cc)`**. If **`vs median`** is **nil**, the product label is uncolored (or **yellow** when **`highlight: true`**). **`buyrates`**: empty **`buyrate`** on **`usd`** rows is **`nil`** in **yellow** (USD target not set in config). **`buyrates`**: **`highlight: true`** → **`buyrates_highlight_prefix`** (default **⚠** ); **`highlight_prefix`** / **`highlight_icon`** per fee. **`buyrates`**: **`note`** unset → secondary currency rows **blank**; first currency row (**USD** when present) with empty note shows gray **`nil`**; when **`note:`** is set, **all** rows for that fee show the note. **`buyrates`** **`note`**: whole-word **`good`** **green**, **`bad`** **red** (table only).

When adding new reports or numeric column types, add them to `numericColPattern` in `pipeline.js` so they stay right-aligned and consistent with existing reports.

### Pipeline Configuration

Configure `commands.pipeline` in `config.yml`:

```yaml
commands:
  pipeline:
    host: "vpn-warehouse.data.dssvc.io"
    port: 5439
    database: "warehouse"
    schema: "stripe"  # For reports (e.g. stripe, STRIPE)
    # data_load_times_schema: "stripe"  # Optional; default = schema above
    # buyrates_date_column: "incurred_at"  # buyrates: override default activity_at if needed
    # buyrates_highlight_prefix: "⚠ "  # optional; default Unicode warning. Use "?" for legacy. Emoji OK (may widen table).
    no_ssl_verify: true  # When VPN/proxy hostname doesn't match Redshift cert
    # buyrates_fees: product_feature_description → number | { usd, gbp, group, note, highlight, highlight_prefix, highlight_icon, display } | …
    # buyrates_fees:
    #   "Card payments - Stripe volume fee":
    #     usd: 0.029
    #     gbp: 0.022
    #   "Some fee - hidden from report":
    #     display: false
    #   "Invoicing - Plus":
    #     group: "Billing"
    #     usd: null
```

Credentials: `PIPELINE_USER` and `PIPELINE_PASSWORD` env vars, or `[pipeline]` section in `.secrets` with `user=` and `password=`.

## Adding New Commands

1. Create new command file in `lib/commands/`
2. Import and register in `bin/stripe-cli`
3. Follow existing patterns for:
   - Error handling (StripeAuthenticationError, StripePermissionError, etc.)
   - Output formatting (table, JSON, CSV where applicable)
   - API key validation
   - User-friendly error messages

## Error Handling Guidelines

- Always catch and handle Stripe API errors gracefully
- Provide specific error messages for common issues:
  - Invalid API key format
  - Authentication errors
  - Permission errors
  - API errors
- Use chalk for colored output (red for errors, green for success, etc.)
- Exit with appropriate status codes

## Output Formatting

- Default to table format for human readability
- Support JSON format for programmatic use
- **Pipeline** (`pipeline.query`, `pipeline.report`): support **csv** (`-o csv`) for reports and ad-hoc SQL (no colors; no data-freshness footer)
- Use chalk for colored output
- Include helpful summary information (e.g., total count)
- Format dates in a readable format
- **Pipeline reports**: See [Report Output Formatting](#report-output-formatting) for table conventions (right-aligned numeric columns, etc.)

## Dependencies

- `commander`: CLI framework
- `stripe`: Official Stripe Node.js SDK
- `chalk`: Terminal string styling
- `table`: Table formatting for output

## Security Considerations

- Never log or expose API keys in error messages
- Validate API key format before making requests
- Handle authentication errors without revealing sensitive information
- Use environment variables for API keys in production

## Resources

### Stripe API Documentation
- [Stripe API Reference](https://stripe.com/docs/api) - Complete API documentation
- [Stripe Connect API](https://stripe.com/docs/connect) - Connect platform documentation
- [Stripe API Keys](https://stripe.com/docs/keys) - API key management and permissions
- [Stripe Webhooks](https://stripe.com/docs/webhooks) - Webhook configuration and handling
- [Stripe SDK Reference](https://stripe.com/docs/api/libraries) - Official SDK documentation

### Key API Endpoints
- **Accounts**: `/v1/accounts` - Connect account management
- **Charges**: `/v1/charges` - Payment processing
- **Customers**: `/v1/customers` - Customer management
- **Payment Intents**: `/v1/payment_intents` - Modern payment processing
- **Webhooks**: `/v1/webhook_endpoints` - Webhook management
- **Network Cost Passthrough**: Refer to internal documentation for cost passthrough API endpoints

### Development Resources
- [Stripe CLI](https://stripe.com/docs/stripe-cli) - Official Stripe CLI tool
- [Stripe Testing](https://stripe.com/docs/testing) - Test cards and scenarios
- [Stripe Connect Testing](https://docs.stripe.com/connect/testing) - Testing guide for Connect accounts and test tokens
- [Stripe Dashboard](https://dashboard.stripe.com) - Web interface for account management

## Stripe API Development Best Practices

### Always Check Stripe Documentation
When working with Stripe API parameters, endpoints, or features:

1. **Verify API Parameters**: Always check the official Stripe API documentation for correct parameter names and usage
   - Use web search to find current Stripe documentation
   - Example: Search "Stripe SetupIntent off_session parameter documentation"
   - Example: Search "Stripe PaymentIntent create parameters"

2. **API Version Compatibility**: Ensure parameters are compatible with the API version being used
   - Current API version: `2023-10-16` (defined in `lib/stripe-client.js`)
   - Some parameters may be deprecated or renamed in newer versions

3. **Common Parameter Issues**:
   - `off_session` parameter is NOT valid for SetupIntents (use `usage: 'off_session'` instead)
   - `confirm: true` works for automatic confirmation of SetupIntents
   - Always verify parameter names match the official documentation exactly

4. **Testing Approach**:
   - Use `--dry-run` mode first to validate without making API calls
   - Test with real Stripe test keys to verify API compatibility
   - Check error messages carefully for parameter validation issues

### Key Stripe Documentation Resources
- [Stripe API Reference](https://stripe.com/docs/api) - Complete API documentation
- [SetupIntents API](https://stripe.com/docs/api/setup_intents) - Payment method setup
- [PaymentIntents API](https://stripe.com/docs/api/payment_intents) - Payment processing
- [Connect API](https://stripe.com/docs/connect) - Platform and connected accounts

## Common Issues

- **`.secrets has overly permissive permissions`** – `chmod 600 .secrets` (enforced by `profile-manager.js`).
- **Pipeline SSL errors via VPN/proxy** – Set `commands.pipeline.no_ssl_verify: true` in `config.yml` or pass `--no-ssl-verify`.
- **Pipeline auth** – Credentials come from `PIPELINE_USER` / `PIPELINE_PASSWORD` env vars or a `[pipeline]` section in `.secrets` (`user=`, `password=`).
- **`-p foo-uat` works but `-p foo` doesn't (or vice versa)** – Key resolution honors required key type per command (`config-loader.js#getRequiredKeyType`); the profile may be missing that specific key type.
