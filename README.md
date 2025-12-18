# Stripe CLI

A command-line tool for making Stripe API calls, starting with Connect account management.

## Features

- List Connect accounts with detailed information
- Beautiful table and JSON output formats
- Comprehensive error handling
- Easy configuration via environment variables or command-line options

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make the CLI executable:
   ```bash
   chmod +x bin/stripe-cli.js
   ```

## Configuration

You can provide your Stripe secret key in multiple ways:

### Option 1: Profile Configuration (Recommended)
Create a `.secrets` file in your project directory:

```ini
[vet]
test_public_key=pk_test_your_test_public_key_here
test_restricted_key=rk_test_your_test_restricted_key_here
test_secret_key=sk_test_your_test_secret_key_here
public_key=pk_live_your_live_public_key_here
restricted_key=rk_live_your_live_restricted_key_here
secret_key=sk_live_your_live_secret_key_here

[daysmart]
test_restricted_key=rk_test_your_daysmart_test_key_here
restricted_key=rk_live_your_daysmart_live_key_here
```

And configure platforms in `config.yml`:

```yaml
global:
  default_platform: "vet"
  test_platform: "vet"

platform:
  vet:
    account: "acct_18yYltEdgy9m3MPr"
    prod_connected_account: "acct_1MzSRtROT734hn6m"
    test_connected_account: "acct_1Rw31tRLzvnMBwNL"
  daysmart:
    account: "acct_1LLF4ZFUW1wgLnXK"
    prod_connected_account: "acct_1Mj22d2V2NLzChjM"
    test_connected_account: ""
```

Then use platforms with the `-p` flag:
```bash
stripe-cli account.list -p vet
stripe-cli account.import.card -f cards.csv -a acct_123 -p daysmart
```

**Profile Variables:**
- `public_key`: Your Stripe public key (pk_*)
- `restricted_key`: Your Stripe restricted key (rk_*)
- `secret_key`: Your Stripe secret key (sk_*) - required for some commands
- `test_public_key`: Your test environment public key
- `test_restricted_key`: Your test environment restricted key  
- `test_secret_key`: Your test environment secret key

**Platform Configuration (config.yml):**
- `default_platform`: Default platform to use when no profile specified
- `test_platform`: Platform to use for testing
- `account`: Platform account ID (used as default for `-a` or `--account` options)
- `prod_connected_account`: Production connected account ID
- `test_connected_account`: Test connected account ID

### Option 2: Default Platform
If no profile is specified, the CLI will use the default platform from your `config.yml` file:
```bash
stripe-cli account.list  # Uses default platform (vet)
```

### Option 3: Environment Variable
```bash
export STRIPE_SECRET_KEY="sk_test_..."
stripe-cli account.list
```

### Option 4: Command Line Option
```bash
stripe-cli account.list --key sk_test_...
```

**Priority Order:**
1. Command line options (highest priority)
   - `--key` option for API key
   - `--account` option for platform account
   - `--connected-account` option for connected account
2. `--platform` option (uses values from specified platform)
3. Default platform from `config.yml` file
4. Environment variables (lowest priority)
   - `STRIPE_SECRET_KEY` for API key

**Important:** Your Stripe API key should start with `sk_` (secret key) or `rk_` (restricted key) and have the necessary permissions to access Connect accounts.

## Usage

### List Connect Accounts

```bash
# Using default profile
stripe-cli account.list

# Using specific profile
stripe-cli account.list -p development
stripe-cli account.list -p production

# Using command line key
stripe-cli account.list --key sk_test_...

# Output as JSON
stripe-cli account.list --format json

# Get help
stripe-cli account.list --help
```

### Search Connect Accounts

```bash
# Search accounts with fuzzy matching
stripe-cli account.search "veterinary"

# Search with wildcards (supports * for any characters)
stripe-cli account.search "*vet*"
stripe-cli account.search "test*"

# Using specific platform
stripe-cli account.search "clinic" -p vet

# Output as JSON
stripe-cli account.search "veterinary" --format json

# Get help
stripe-cli account.search --help
```

The search command searches across multiple fields:
- Account ID
- Email address
- Business name
- DBA (Doing Business As)
- Display name
- Metadata fields (name, dba, descriptor)

### Account Settings

```bash
# Enable network cost passthrough for a connected account
stripe-cli account.setting.network-cost.enable -a acct_1234567890

# Disable network cost passthrough for a connected account
stripe-cli account.setting.network-cost.disable -a acct_1234567890

# Check network cost passthrough status
stripe-cli account.setting.network-cost.status -a acct_1234567890

# Delete a scheduled scheme
stripe-cli account.setting.network-cost.delete-scheme -a acct_1234567890 --scheme-id pcsch_1234567890

# Schedule future activation (using Unix timestamp)
stripe-cli account.setting.network-cost.enable -a acct_1234567890 --starts-at 1754502193

# Use with specific profile
stripe-cli account.setting.network-cost.enable -a acct_1234567890 -p production

# Get help for account settings
stripe-cli account.setting.network-cost.enable --help
```

### Card Data Import

Import card data from a CSV file to a Stripe connected account. The command creates customers, payment methods, and setup intents in Stripe to save cards for future use with the `off_session` option. Outputs a CSV file containing the original data (with masked card numbers), Stripe payment method IDs, customer IDs, setup intent IDs, and setup intent payment method IDs.

**Command Options:**
- `-f, --file <file>`: CSV file path (required)
- `-a, --account <account>`: Platform account ID (required, unless specified in profile)
- `-ca, --connected-account <connected_account>`: Connected account ID associated with platform account (optional)
- `-k, --key <key>`: Stripe secret key (optional, uses profile or environment if not specified)
- `-p, --platform <platform>`: Use platform from .secrets config file (optional)
- `--format <format>`: Output format (table, json) - default: table
- `--dry-run`: Validate CSV without creating cards
- `--verbose`: Show detailed progress output
- `--delimiter <delimiter>`: CSV delimiter (default: comma)
- `-o, --output <output>`: Output CSV file name (default: imported_cards_TIMESTAMP.csv)

```bash
# Import card data from CSV file to a platform account
stripe-cli account.import.card -f cards.csv -a acct_platform_1234567890

# Import to a specific connected account associated with a platform account
stripe-cli account.import.card -f cards.csv -a acct_platform_1234567890 -ca acct_connected_1234567890

# Import with specific profile (uses account and connected_account from profile if configured)
stripe-cli account.import.card -f cards.csv -p production

# Import with profile but override the connected account
stripe-cli account.import.card -f cards.csv -p production -ca acct_override_1234567890

# Import with dry-run mode (validate without creating)
stripe-cli account.import.card -f cards.csv -a acct_platform_1234567890 --dry-run

# Import with custom delimiter
stripe-cli account.import.card -f cards.csv -a acct_platform_1234567890 --delimiter ";"

# Import with progress updates
stripe-cli account.import.card -f cards.csv -a acct_platform_1234567890 --verbose

# Get help for card import
stripe-cli account.import.card --help
```

#### CSV Format

The CSV file should contain the following columns in this exact order:

```csv
card,exp,first,last,zip,token
4242424242424242,12/25,John,Doe,12345,tok_1234567890abcdef
5555555555554444,06/26,Jane,Smith,67890,
4000000000000002,03/27,Bob,Johnson,54321,tok_abcdef1234567890
```

**Column Descriptions:**
- `card`: Card number (without spaces or dashes)
- `exp`: Expiration date in MM/YY or MMYY format
- `first`: Cardholder first name (optional)
- `last`: Cardholder last name (optional)
- `zip`: Billing ZIP/postal code (optional)
- `token`: Card token from 3rd party processor (optional)

**Notes:**
- The first row should contain the column headers
- Card numbers should be 13-19 digits without spaces or dashes
- Expiration dates should be in MM/YY or MMYY format
- Only `card` and `exp` fields are required; `first`, `last`, `zip`, and `token` are optional
- Empty rows will be skipped
- Invalid rows will be logged and skipped

#### Output Format

The import command generates a CSV file with the following columns, organized into logical sections:

```csv
card_last_4,exp,first,last,zip,token,platform_account,connected_account,stripe_payment_method_id,stripe_customer_id,stripe_setup_intent_id,stripe_setup_intent_payment_method_id,stripe_card_brand,stripe_card_last4,stripe_card_exp_month,stripe_card_exp_year,status,error
************4242,12/25,John,Doe,12345,,acct_18yYltEdgy9m3MPr,acct_1Rw31tRLzvnMBwNL,pm_1234567890abcdef,cus_1234567890abcdef,seti_1234567890abcdef,pm_1234567890abcdef,visa,4242,12,2025,success,
************4444,06/26,Jane,Smith,67890,,acct_18yYltEdgy9m3MPr,acct_1Rw31tRLzvnMBwNL,pm_abcdef1234567890,cus_abcdef1234567890,seti_abcdef1234567890,pm_abcdef1234567890,mastercard,4444,6,2026,success,
```

**Output Column Descriptions:**

**Original Data (from input CSV):**
- `card_last_4`: Original card number with only last 4 digits visible (masked for security)
- `exp`: Original expiration date
- `first`: Original first name
- `last`: Original last name  
- `zip`: Original ZIP code
- `token`: Original token (if provided)

**Account Information (used for import):**
- `platform_account`: Platform account ID used for the import
- `connected_account`: Connected account ID used for the import (if specified)

**Stripe Data (created by import):**
- `stripe_payment_method_id`: Stripe payment method ID (pm_...)
- `stripe_customer_id`: Stripe customer ID (cus_...)
- `stripe_setup_intent_id`: Stripe setup intent ID (seti_...) - used to save card for future use
- `stripe_setup_intent_payment_method_id`: Payment method ID from the setup intent (pm_...)
- `stripe_card_brand`: Card brand (visa, mastercard, etc.)
- `stripe_card_last4`: Last 4 digits from Stripe
- `stripe_card_exp_month`: Expiration month from Stripe
- `stripe_card_exp_year`: Expiration year from Stripe

**Import Results:**
- `status`: Import status (success/failed)
- `error`: Error message (if failed)

## File Requirements

### CSV File Specifications

**File Format:**
- File extension: `.csv`
- Encoding: UTF-8 (recommended)
- Line endings: Unix (LF) or Windows (CRLF)
- Maximum file size: 100MB
- Maximum rows: 100,000 cards per import

**Column Validation:**
- `card`: Must be 13-19 digits, no spaces, dashes, or special characters
- `exp`: Must be in MM/YY or MMYY format (e.g., "12/25", "06/26", "1225", "0626")
- `first`: Cardholder first name, 1-50 characters (optional)
- `last`: Cardholder last name, 1-50 characters (optional)
- `zip`: Billing ZIP/postal code, 3-10 characters (optional, letters, numbers, spaces, hyphens allowed)
- `token`: Card token from 3rd party processor, 1-100 characters (optional)

**Data Validation:**
- Card numbers are validated using Luhn algorithm
- Expiration dates must be in the future (supports both MM/YY and MMYY formats)
- ZIP codes are validated based on country format

**Error Handling:**
- Invalid rows are logged with specific error messages
- Import continues processing valid rows
- Summary report shows successful vs failed imports
- Detailed error log available with `--verbose` flag

**Supported Delimiters:**
- Comma (`,`): Default
- Semicolon (`;`): Use `--delimiter ";"`
- Tab (`\t`): Use `--delimiter "\t"`
- Pipe (`|`): Use `--delimiter "|"`

**File Examples:**

**Valid CSV:**
```csv
card,exp,first,last,zip,token
4242424242424242,12/25,John,Doe,12345,tok_1234567890abcdef
5555555555554444,0626,Jane,Smith,67890,
4000000000000002,03/27,,,54321,tok_abcdef1234567890
4111111111111111,12/26,Alice,,,
```

**Invalid CSV (will cause errors):**
```csv
card,exp,first,last,zip
4242-4242-4242-4242,12/25,John,Doe,12345
5555555555554444,13/25,Jane,Smith,67890
4000000000000002,03/27,Bob123,Johnson,54321
```

### Profile Management

```bash
# List all configured profiles
stripe-cli config.platform.list

# Get help for platform commands
stripe-cli config.platform.list --help
```

### Output Formats

The tool supports two output formats:

1. **Table format (default)**: Displays accounts in a nicely formatted table with columns for ID, email, country, type, charges enabled, payouts enabled, and creation date.

2. **JSON format**: Outputs raw JSON data for programmatic use.

## Example Output

### Table Format
```
┌─────────────────┬─────────────────────┬─────────┬──────┬─────────────────┬─────────────────┬────────────┐
│ ID              │ Email               │ Country │ Type │ Charges Enabled │ Payouts Enabled │ Created    │
├─────────────────┼─────────────────────┼─────────┼──────┼─────────────────┼─────────────────┼────────────┤
│ acct_1234567890 │ user@example.com    │ US      │ express │ ✓              │ ✓               │ 1/15/2024  │
└─────────────────┴─────────────────────┴─────────┴──────┴─────────────────┴─────────────────┴────────────┘

Total accounts: 1
```

### JSON Format
```json
[
  {
    "id": "acct_1234567890",
    "email": "user@example.com",
    "country": "US",
    "type": "express",
    "charges_enabled": true,
    "payouts_enabled": true,
    "created": 1705276800
  }
]
```

## Error Handling

The tool provides clear error messages for common issues:

- **Invalid API key**: When the provided key is malformed or invalid
- **Authentication errors**: When the API key is incorrect
- **Permission errors**: When the API key lacks required permissions
- **API errors**: When Stripe returns an error response

## Development

### Project Structure
```
stripe-cli/
├── bin/
│   └── stripe-cli.js          # Main CLI entry point
├── lib/
│   ├── commands/
│   │   └── account.js         # Account-related commands
│   └── stripe-client.js       # Stripe API client configuration
├── package.json
└── README.md
```

### Adding New Commands

To add new commands:

1. Create a new command file in `lib/commands/`
2. Import and register the command in `bin/stripe-cli.js`
3. Follow the existing pattern for error handling and output formatting

## Requirements

- Node.js 14.0.0 or higher
- Valid Stripe secret key with appropriate permissions

## License

MIT
