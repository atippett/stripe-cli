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
Create a `.profile` file in your project directory:

```ini
[default]
profile=development

[development]
key=your_test_api_key_here
description=Development environment with test keys

[production]
key=your_live_api_key_here
description=Production environment with live keys
```

Then use profiles with the `-p` flag:
```bash
stripe-cli account list -p development
stripe-cli account list -p production
```

### Option 2: Default Profile
If no profile is specified, the CLI will use the default profile from your `.profile` file:
```bash
stripe-cli account list  # Uses default profile
```

### Option 3: Environment Variable
```bash
export STRIPE_SECRET_KEY="sk_test_..."
stripe-cli account list
```

### Option 4: Command Line Option
```bash
stripe-cli account list --key sk_test_...
```

**Priority Order:**
1. `--key` option (highest priority)
2. `--profile` option
3. Default profile from `.profile` file
4. `STRIPE_SECRET_KEY` environment variable (lowest priority)

**Important:** Your Stripe API key should start with `sk_` (secret key) or `rk_` (restricted key) and have the necessary permissions to access Connect accounts.

## Usage

### List Connect Accounts

```bash
# Using default profile
stripe-cli account list

# Using specific profile
stripe-cli account list -p development
stripe-cli account list -p production

# Using command line key
stripe-cli account list --key sk_test_...

# Output as JSON
stripe-cli account list --format json

# Get help
stripe-cli account list --help
```

### Account Settings

```bash
# Enable network cost passthrough for a connected account
stripe-cli account settings network-costs enable -a acct_1234567890

# Disable network cost passthrough for a connected account
stripe-cli account settings network-costs disable -a acct_1234567890

# Check network cost passthrough status
stripe-cli account settings network-costs status -a acct_1234567890

# Delete a scheduled scheme
stripe-cli account settings network-costs delete-scheme -a acct_1234567890 --scheme-id pcsch_1234567890

# Schedule future activation (using Unix timestamp)
stripe-cli account settings network-costs enable -a acct_1234567890 --starts-at 1754502193

# Use with specific profile
stripe-cli account settings network-costs enable -a acct_1234567890 -p production

# Get help for account settings
stripe-cli account settings --help
```

### Profile Management

```bash
# List all configured profiles
stripe-cli profile list

# Get help for profile commands
stripe-cli profile --help
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
