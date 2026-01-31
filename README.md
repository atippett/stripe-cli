# Stripe CLI

A command-line tool for making Stripe API calls, including Connect account management, card import, customer management, and network cost passthrough.

## Features

- **Connect accounts**: List and search Connect accounts with table or JSON output
- **Card import**: Import card data from CSV to a connected account (default or CardPointe format), with live progress bar and metadata tagging
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
    mode: "test"
    connected_account: "acct_1Rw31tRLzvnMBwNL"

  daysmart:
    account: "acct_1LLF4ZFUW1wgLnXK"

  daysmart-uat:
    account: "acct_1LLF4ZFUW1wgLnXK"
    connected_account: "acct_1MMHptFa2mkwl760"
    mode: "test"
```

- **UAT/test platforms** (e.g. `vet-uat`, `daysmart-uat`): Dedicated profiles in `.secrets` with the same key names (`restricted_key`, `secret_key`, etc.) but test key values. In `config.yml` they use `mode: "test"` and a test `connected_account`. Use `-p vet-uat` or `-p daysmart-uat` to run against test.
- **`account`**: Platform account ID; required for some commands.
- **`connected_account`**: Single connected account for that platform (used for import, customer delete, etc.).

Then use the `-p` flag:

```bash
./bin/stripe-cli account.list -p vet
./bin/stripe-cli account.import.card -p daysmart-uat -ca acct_xxx < cards.csv
```

### Other ways to provide the key

- **Environment**: `export STRIPE_SECRET_KEY="sk_test_..."`
- **Command line**: `./bin/stripe-cli account.list --key sk_test_...`

**Priority**: `--key` > `--platform` (from `.secrets`) > default platform from `config.yml` > `STRIPE_SECRET_KEY`.

## Usage

### List and search Connect accounts

```bash
./bin/stripe-cli account.list
./bin/stripe-cli account.list -p vet --format json

./bin/stripe-cli account.search "veterinary"
./bin/stripe-cli account.search "*vet*" -p vet
```

### Card import

Import cards from CSV into a Stripe connected account. Creates customers, payment methods, and setup intents. Output is CSV (or JSON with `--format json`) to **stdout**; progress and summary go to stderr.

**Options:**

- `-f, --file <file>` – CSV file path, or read from **stdin** (e.g. `./bin/stripe-cli account.import.card -p dash-uat -ca acct_xxx < file.csv`)
- `-a, --account` – Platform account ID (or from profile)
- `-ca, --connected-account` – Connected account to import into
- `-p, --platform` – Platform from `.secrets`
- `-m, --metadata <key=value...>` – Metadata on created customers (e.g. `--metadata env=uat`). If omitted, `import_date` (ISO timestamp) is set automatically so imports can be tagged and reverted.
- `--source cardpointe` or `--source-cardpointe` – CardPointe CSV format (see below)
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
│   │   ├── account.js          # account.list, account.search
│   │   ├── account-settings.js # network cost passthrough
│   │   ├── capabilities.js     # account.capabilities.*
│   │   ├── cards.js            # account.import.card
│   │   ├── customer.js         # account.customer.delete
│   │   └── test-account.js     # test.account.generate
│   ├── config-loader.js
│   ├── profile-manager.js
│   └── stripe-client.js
├── config.yml                  # Platforms and command key requirements
├── kyc.yml                     # Test account / KYC test data
├── package.json
└── README.md
```

## Requirements

- Node.js 14+
- Stripe API key (`sk_` or `rk_`) with needed permissions

## License

MIT
