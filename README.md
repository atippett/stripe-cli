# Stripe CLI

A command-line tool for making Stripe API calls, including Connect account management, card import, customer management, and network cost passthrough.

## Features

- **Connect accounts**: List and search Connect accounts; create account links for Connect onboarding
- **Checkout session setup**: Create setup-mode Checkout Sessions for connected accounts (e.g. bank account collection via `customer_account`)
- **Pipeline (Redshift)**: Run SQL queries and canned reports (e.g. connect_volume) against the Stripe Data Pipeline Redshift database
- **Card import**: Import card data from CSV to a connected account (default or CardPointe format), with live progress bar and metadata tagging
- **Card migration map**: Full-outer-join a CardConnect export with a Stripe migration result CSV; offline, no API calls
- **Customer management**: Delete customers by ID, by metadata, or all (test keys only), with y/n/ALL prompts
- **Network cost passthrough**: Enable, disable, check status, and delete scheduled schemes for connected accounts
- **Profiles**: Multiple platforms and UAT/test profiles via `.secrets` and `config.yml`
- **Error handling**: Clear errors and optional prompts before destructive actions

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make the CLI executable:
   ```bash
   chmod +x bin/stripe-cli
   ```

## Configuration

### Profile configuration (recommended)

Create a `.secrets` file in the project root. Use **separate profiles** for production and UAT/test: production profiles (e.g. `vet`, `daysmart`) and UAT/test profiles (e.g. `vet-uat`, `daysmart-uat`) each have their own section with the same key names (`public_key`, `restricted_key`, `secret_key`). No `test_`-prefixed keys.

```ini
# Production profile
[vet]
public_key=pk_live_...
restricted_key=rk_live_...
secret_key=sk_live_...

# UAT/test profile (separate section; keys are test keys)
[vet-uat]
public_key=pk_test_...
restricted_key=rk_test_...
secret_key=sk_test_...

# Production profile
[daysmart]
restricted_key=rk_live_...
secret_key=sk_live_...

# UAT/test profile (separate section)
[daysmart-uat]
restricted_key=rk_test_...
secret_key=sk_test_...
```

Configure platforms in `config.yml`:

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

- **UAT/test platforms** (e.g. `vet-uat`, `daysmart-uat`): Platform names ending with `-uat` or `-test` imply test mode. Use dedicated profiles in `.secrets` with test keys and `connected_account` in `config.yml`. Use `-p vet-uat` or `-p daysmart-uat` to run against test.
- **`account`**: Platform account ID; required for some commands.
- **`connected_account`**: Single connected account for that platform (used for import, customer delete, etc.).

Use the `-p` and `-k` flags (global; can appear before or after the command):

```bash
./bin/stripe-cli -p vet account.list
./bin/stripe-cli account.list -p vet
./bin/stripe-cli -p daysmart-uat account.import.card -ca acct_xxx < cards.csv
./bin/stripe-cli account.import.card -p daysmart-uat -ca acct_xxx < cards.csv
```

### Other ways to provide the key

- **Environment**: `export STRIPE_SECRET_KEY="sk_test_..."`
- **Command line**: `./bin/stripe-cli account.list --key sk_test_...`

**Priority**: `--key` > `--platform` (from `.secrets`) > default platform from `config.yml` > `STRIPE_SECRET_KEY`.

**Key type**: Commands default to the **restricted key** (`rk_*`). Per-command overrides live in `config.yml` under `commands.<name>.key: "secret"` for the handful of operations that must use a secret key. When the resolved type is restricted and the profile has no `restricted_key`, the CLI falls back to `secret_key` from the same profile (one-way fallback — secret-required commands never fall back to a restricted key). Explicit `--key sk_…`/`--key rk_…` is still strictly validated against the command's required type.

## Usage

### List and search Connect accounts

```bash
./bin/stripe-cli account.list
./bin/stripe-cli account.list -p vet --format json

./bin/stripe-cli account.search "veterinary"
./bin/stripe-cli account.search "*vet*" -p vet
```

### Account link (Connect onboarding)

Create a [Stripe account link](https://docs.stripe.com/api/account_links/create) for Connect onboarding. Single-use URL; the account can be given with `-a` or taken from the profile’s `account` in config.yml when using `-p` (or the default platform).

```bash
./bin/stripe-cli account.link -p vet
./bin/stripe-cli account.link -a acct_xxx --type account_onboarding --refresh-url https://yourapp.com/reauth --return-url https://yourapp.com/return --format json
```

Options: `-a, --account` (optional if profile has `account` in config.yml), `--type` (account_onboarding | account_update), `--refresh-url`, `--return-url`, `--collection-fields` (currently_due | eventually_due), `--collection-future-requirements` (include | omit), `-k`, `-p`, `-f, --format`.

### Checkout session setup (bank account collection)

Create a Checkout Session in setup mode for a connected account (e.g. collect US bank account). Uses `customer_account` (Accounts v2) so the account is the customer and the payment method attaches directly to the account.

```bash
./bin/stripe-cli -p dash checkout.session.setup acct_1Sx7PnGmlKfuKPKU
./bin/stripe-cli checkout.session.setup acct_xxx --success-url https://yourapp.com/success --cancel-url https://yourapp.com/cancel
```

Options: `--success-url`, `--cancel-url`, `--currency` (default: usd), `--payment-method-types` (default: us_bank_account), `--customer` (legacy Customer ID for stripeAccount flow), `--customer-email` (legacy flow), `-k`, `-p`, `-f, --format`.

### Pipeline (Stripe Data Pipeline → Redshift)

Run SQL queries against the Stripe Data Pipeline Redshift database. Configure `host`, `port`, and `database` under `commands.pipeline` in `config.yml`. Credentials via `PIPELINE_USER` and `PIPELINE_PASSWORD` env vars, or `[pipeline]` section in `.secrets` with `user=` and `password=`. In **table** output, empty cells render as gray **`nil`** (**JSON**/**CSV** use plain empty values). **`--format csv`** prints a header row and RFC 4180–style escaping; **JSON**/**CSV** omit the data-freshness footer and use raw cell values (no ANSI colors). **`pipeline.report buyrates`**: empty **`buyrate`** on **`usd`** rows uses **yellow** **`nil`** when no USD target is configured for that row. **`vs median`** uses **green** when ~**0**, **blue** when negative, **red** when positive (table only; JSON unstyled). The **Product** column is **`Feature name (cc)`** (lowercase currency code)—no separate **currency** column—and uses the **same** colors as **`vs median`** when a value and % are present. **Table** rows are indented with two leading spaces under each **`group`** section header (**JSON** **`product`** has no indent). **`highlight: true`** prepends **`buyrates_highlight_prefix`** (default **⚠** )—tinted like **`vs median`** when the % is present, otherwise **yellow**; override with **`commands.pipeline.buyrates_highlight_prefix`** or per-fee **`highlight_prefix`** / **`highlight_icon`**. Use **`buyrates_highlight_prefix: "?"`** for the old ASCII marker; optional **`note:`** on a fee object is the last column (repeated on each currency row for that fee). In **`note`** (table only), whole-word **`good`** is **green** and **`bad`** is **red** (JSON is plain text).

```bash
./bin/stripe-cli pipeline.query --query "SELECT 1 AS test"
./bin/stripe-cli pipeline.query -f query.sql --format json
./bin/stripe-cli pipeline.report buyrates --period 2026-03 -o csv
./bin/stripe-cli pipeline.report connect_volume
./bin/stripe-cli pipeline.report connect_volume --days 7 --format json
./bin/stripe-cli pipeline.report reserves --period last90 --normalize
./bin/stripe-cli pipeline.report buyrates
./bin/stripe-cli pipeline.report buyrates --period mtd
./bin/stripe-cli pipeline.report buyrates --period 2026-02
./bin/stripe-cli pipeline.report
./bin/stripe-cli pipeline.report.list
```

Options for `pipeline.query`: `-q, --query` (inline SQL), `-f, --file` (path to .sql file), `--host`, `--port`, `--database` (override config), `--no-ssl-verify` (skip SSL cert verification for VPN/proxy), `-o, --format` (table | json | csv).

With no report name, `pipeline.report` prints the same **available reports** list as `pipeline.report.list`.

Options for `pipeline.report`: `--period` (mtd, yesterday, today, prior_month, last7, last30, last90, last12m, last6m, 7d, 30d, 90d, **YYYY-MM** full calendar month, YYYY-MM-DD, YYYY-MM-DD..YYYY-MM-DD), `--days` (default 30 for most reports, ignored if `--period` set; `buyrates` defaults to **prior calendar month** when neither `--period` nor `--days` is set), `--limit` (default 100), `--type` (payment method type: card, us_bank_account, etc. Default: all payment methods, no filter. Use `all` explicitly to group by type), `--normalize` (convert currencies to USD), `--schema`, `--buyrates-date-column` (buyrates only: `itemized_fees` timestamp column for the date filter), `--data-load-times-schema` (where `data_load_times` lives; default: `data_load_times_schema` in config or same as `--schema`), `--skip-data-load-times` (skip freshness footer), `--no-ssl-verify`, `-o, --format` (table | json | csv). Reports support `{{start_date}}`, `{{end_date}}`, `{{limit}}`, `{{schema}}`, `{{buyrates_date_col}}` (buyrates), and normalize placeholders.

**`buyrates`** — From [`itemized_fees`](https://docs.stripe.com/stripe-data/query-all-fees-data): **`product`** (**Product**) as **`Feature (cc)`**, then **`buyrate`** (only if config lists that **`currency`**, or a **scalar** applies to every row—no fill from **`usd`** alone). **`buyrate fx`** is **`buyrate` ÷ `usd fx`** (USD-comparable vs median) when **`buyrate`** is set; when **`buyrate`** is empty, the row isn’t **`usd`**, and nested config has **`usd`** only, **`usd` × `usd fx`** from config (same units as **`median`**). **`vs median`**: **100 × (median − buyrate fx) ÷ buyrate fx** (rounded **%** in the table). Median **over (+)** / **under (−)** **buyrate fx** (**`nil`** if either value is missing or **buyrate fx** is **0**). Config: **`commands.pipeline.buyrates_fees`** or **`buyrates_fee_usd`** (YAML keys are matched to **`product_feature_description`**; ends trimmed, internal runs of spaces collapsed). Optional **`group: "…"`** on a fee object adds a **section header row** (full row, **Product** = group name in **cyan bold**, other columns blank) and lists fees sharing that name. Fees **without** **`group`** (including scalars and fees missing from config) belong to **`Core`**. Sections are ordered **alphabetically** by group name. **`display: false`** on a fee entry (object) drops that product’s rows from the buyrates report. **`highlight: true`** on a fee entry (table output only) prefixes **Product** with **`buyrates_highlight_prefix`** (default **⚠** + space); that cell uses the **same** **green** / **blue** / **red** tint as **`vs median`** when the % exists, else **yellow**; optional per-fee **`highlight_prefix`** / **`highlight_icon`**. JSON uses plain **`product`** (no prefix, no flag). Column order: **`buyrate`**, **`usd fx`**, **`buyrate fx`**, **`median`**, **`vs median`**, **`max`**, **`min`**, **`amount`** (sum of **`itemized_fees.amount`** for the report window), **`est. savings`** (**`amount` − `buyrate fx` × `count`**; **`nil`** if **buyrate fx** missing), **`count`**, **`note`** (last column, **center** in table; config **`note:`**). The same **`note`** text appears on **every** currency row for that fee. Rounded **`vs median`** **0%** adds **`ok`** in **green** in **table** output (or **`ok ·`** + config **`note`** when both apply; JSON is plain text). Other **`note`** text still applies **good**/**bad** keyword coloring (table only). Table output uses **3** decimals for **`buyrate`**, **`buyrate fx`**, **`median`**, **`max`**, and **`min`**; **`buyrate fx`** is **half-up** rounded to **3** dp after compute (same value as **`vs median`**); **`amount`** is **rounded to the nearest integer** in table output; **`est. savings`** is **rounded to the nearest integer** (table and JSON; **half-up** from **`amount` − `buyrate fx` × `count`**); **`vs median`** is a **rounded integer + `%`** (no decimals); **`usd fx`** at least **3** (up to **8**); **`count`** as a whole number. **`usd fx`** is USD→row currency via [`exchange_rates_from_usd`](https://docs.stripe.com/stripe-data/query-all-fees-data) on the last day in the report window, read as **`DECIMAL(38,18)`** in the report SQL so rates are not narrowed to binary float. **`median`** uses Redshift **`APPROXIMATE PERCENTILE_DISC(0.5)`** on large windows; min/max/count are exact. **`usd`** rows use **`usd fx` = 1**. **Product** embeds the row currency as **`(usd)`**, **`(gbp)`**, etc. Date filter **`activity_at`** by default; override with `buyrates_date_column` or **`--buyrates-date-column`**. Default window **prior calendar month**; use `--period prior_month` or `--days` as needed.

After each canned report (**table** output only; not **`--format json`** or **`csv`**), the CLI queries Stripe’s [`data_load_times`](https://docs.stripe.com/stripe-data/available-data) table for the underlying datasets and prints a **Data freshness** footer with each table’s `loaded` timestamp. With `--period mtd`, volume reports also print a **month-end projection** (UTC): primary estimate **sums the prior complete calendar week (Mon–Sun) by day-of-week**, then applies that pattern to each remaining day in the month (reduces weekend/weekday skew vs. naive linear). A **linear** estimate is shown alongside for reference. Stalest `data_load_times.loaded` is still cited when freshness was queried.

### Card import

Import cards from CSV into a Stripe connected account. Creates customers, payment methods, and setup intents. Output is CSV (or JSON with `--format json`) to **stdout**; progress and summary go to stderr.

**Options:**

- `-f, --file <file>` – CSV file path, or read from **stdin** (e.g. `./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx < file.csv`)
- `-a, --account` – Platform account ID (or from profile)
- `-ca, --connected-account` – Connected account to import into
- `-p, --platform` – Platform from `.secrets`
- `-m, --metadata <key=value...>` – Metadata on created customers (e.g. `--metadata env=uat`). If omitted, `import_date` (ISO timestamp) is set automatically so imports can be tagged and reverted.
- `--source cardpointe` or `--source-cardpointe` – CardPointe CSV format (see below). CardPointe format is auto-detected when the CSV has `card number` and `expiry` columns.
- `--limit <number>` – Import only the first N cards from the file
- `--concurrency <number>` – Max concurrent imports (default: 5, max: 20)
- `--dry-run` – Validate CSV only, no API calls
- `--verbose` – Per-card progress
- `--delimiter` – CSV delimiter (default: comma)

**Examples:**

```bash
# From file with platform
./bin/stripe-cli account.import.card -f cards.csv -p dash-uat -ca acct_xxx

# From stdin (e.g. pipe or redirect)
./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx < cards.csv

# CardPointe format with metadata
./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx --source=cardpointe --metadata import=v1 < cardpointe.csv

# Dry run
./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx --dry-run < cards.csv

# Import only first 10 cards
./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx --limit 10 -f cards.csv

# Import with higher concurrency (faster for large files)
./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx -f cards.csv --concurrency 10
```

**Default CSV columns:** `card`, `exp`, `first`, `last`, `zip`, `token`

**CardPointe CSV columns:**  
`merchid`, `profileid`, `acctid`, `defaultacct`, `token`, `card number`, `accttype`, `expiry`, `name`, `address`, `address2`, `city`, `state`, `country`, `postal`, `phone`, `email`, `company`

**Output:** CSV to stdout: original input columns first, then Stripe columns with `stripe_` prefix (`stripe_platform_account`, `stripe_connected_account`, `stripe_payment_method_id`, `stripe_customer_id`, `stripe_setup_intent_id`, etc., plus `stripe_status`, `stripe_error`).

### Customer delete

Delete customers by ID, by metadata, or all (test keys only). **All delete actions prompt for confirmation** (y/n). For multi-customer flows, you can type **ALL** to delete the rest without further prompts.

```bash
# Delete one customer (prompts: y/n)
./bin/stripe-cli account.customer.delete cus_xxx -p dash-uat

# Delete all customers matching metadata (prompts for each, or type ALL)
./bin/stripe-cli account.customer.delete --metadata import_date=2026-01-30T23:44:00.000Z -p dash-uat

# Delete all customers on the account (test keys only; prompts for each, or type ALL)
./bin/stripe-cli account.customer.delete --all -p dash-uat
```

Options: `-k`, `-p`, `-a`, `-ca`, `--format`.

### Card migration map (CardConnect ↔ Stripe)

Full-outer-join a CardConnect export (per-card rows) against a Stripe migration result CSV (the file Stripe returns after a card PM import). Joins on `profileid == old_id` + card last4 + expiry month/year. Output is a single CSV with every matched pair plus any unmatched rows from either side. Read-only and offline — no Stripe API calls.

```bash
./bin/stripe-cli migrate.card.map \
  --cardconnect cc_export.csv \
  --stripe import_acct_xxx_card_pms_migreq_...csv \
  > tmp/cards_map.csv
```

Options:

- `--cardconnect <file>` – CardConnect export CSV (required; needs columns `profileid`, `acctid`, `token`, `expiry`; every `acctid` value must be a non-empty positive integer)
- `--stripe <file>` – Stripe migration result CSV (required; needs columns `old_id`, `created_customer`, `source_new_id`, `card_last4`, `card_exp_month`, `card_exp_year`)
- `--format <fmt>` – `csv` (default) or `json`

**Output columns:** `match_status` (`matched` | `cardconnect_only` | `stripe_only`), `stripe_connected_account` (sniffed from the Stripe filename `import_acct_XXX_card_pms_…`; blank if the filename doesn't match), then all CardConnect columns, then all Stripe columns prefixed with `stripe_`. Card numbers (`card`, `card number`) are masked. Summary counts go to stderr.

**Card last4 source:** taken from the CardConnect `token` column (CardConnect tokens preserve the original card's last 4 digits), so this works on no-PAN exports.

### Account settings (network cost passthrough)

```bash
./bin/stripe-cli account.setting.network-cost.enable -a acct_xxx
./bin/stripe-cli account.setting.network-cost.disable -a acct_xxx
./bin/stripe-cli account.setting.network-cost.status -a acct_xxx
./bin/stripe-cli account.setting.network-cost.delete-scheme -a acct_xxx --scheme-id pcsch_xxx
```

Each delete/disable action prompts (y/n) before running.

### Platform and config

```bash
./bin/stripe-cli config.platform.list
```

## Output and behavior

- **Progress**: Card import shows a live progress bar on stderr (unless `--verbose`).
- **Summary**: Import summary (and other status messages) are on stderr; CSV/JSON results are on stdout so you can redirect: `./bin/stripe-cli account.import.card ... > results.csv`.
- **Validation**: Invalid cards and failed imports are only shown in the summary when count > 0.

## Project structure

```
stripe-cli/
├── bin/
│   └── stripe-cli              # CLI entry point
├── lib/
│   ├── commands/
│   │   ├── account.js          # account.list, account.search, account.link
│   │   ├── account-settings.js # network cost passthrough
│   │   ├── capabilities.js     # account.capabilities.*
│   │   ├── cards.js            # account.import.card
│   │   ├── checkout.js         # checkout.session.setup
│   │   ├── customer.js         # account.customer.delete
│   │   ├── migrate-cards.js    # migrate.card.map (CardConnect ↔ Stripe full outer join)
│   │   ├── pipeline.js         # pipeline.query, pipeline.report (Redshift)
│   │   └── test-account.js     # test.account.generate
│   ├── config-loader.js
│   ├── profile-manager.js
│   └── stripe-client.js
├── config.yml                  # Platforms and command key requirements
├── kyc.yml                     # Test account / KYC test data
├── reports/                    # Canned pipeline reports (*.sql)
│   ├── buyrates.sql            # median/max/min/amount + usd fx (default: prior month)
│   ├── connect_balance_transactions.sql  # Volume from balance_transactions
│   ├── connect_volume.sql      # NET volume from charges (amount - amount_refunded)
│   └── reserves.sql            # Reserve balance: starting + period activity = ending (uses summarized_balance_transactions)
├── package.json
└── README.md
```

## Requirements

- Node.js 14+
- Stripe API key (`sk_` or `rk_`) with needed permissions

## License

MIT
