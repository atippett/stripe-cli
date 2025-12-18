# AGENTS.md

A CLI tool for making Stripe API calls, starting with Connect account management.

## Project Overview

This is a Node.js CLI tool built with Commander.js that provides a command-line interface for Stripe API operations. The current implementation focuses on Connect account management, with plans to expand to other Stripe API endpoints.

## Setup Commands

- Install dependencies: `npm install`
- Make CLI executable: `chmod +x bin/stripe-cli.js`
- Test CLI help: `node bin/stripe-cli.js --help`

## Development Environment

- Node.js 14.0.0 or higher required
- Uses npm for package management
- No build step required - direct Node.js execution
- CLI entry point: `bin/stripe-cli.js`

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
│   └── stripe-cli.js          # Main CLI entry point
├── lib/
│   ├── commands/
│   │   └── account.js         # Account-related commands
│   └── stripe-client.js       # Stripe API client configuration
├── package.json
├── README.md
└── AGENTS.md
```

## Testing Instructions

- Test CLI help: `node bin/stripe-cli.js --help`
- Test account list help: `node bin/stripe-cli.js account list --help`
- Test with invalid key: `node bin/stripe-cli.js account list --key invalid_key`
- Test with valid key: `node bin/stripe-cli.js account list --key rk_test_...`
- Test account settings: `node bin/stripe-cli.js account.setting.network-cost.enable --help`
- Test network cost passthrough: `node bin/stripe-cli.js account.setting.network-cost.enable --help`

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

Create a `.secrets` file in the project root:

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

### Platform Commands

- `stripe-cli config.platform.list` - List all configured platforms and their settings
- `stripe-cli account.list -p vet` - Use specific platform
- `stripe-cli account.list` - Use default platform
- `stripe-cli account.search "veterinary"` - Search accounts with fuzzy matching
- `stripe-cli account.search "*vet*"` - Search with wildcards

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

## Adding New Commands

1. Create new command file in `lib/commands/`
2. Import and register in `bin/stripe-cli.js`
3. Follow existing patterns for:
   - Error handling (StripeAuthenticationError, StripePermissionError, etc.)
   - Output formatting (table and JSON formats)
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
- Use chalk for colored output
- Include helpful summary information (e.g., total count)
- Format dates in a readable format

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

## Future Enhancements

- Add more Stripe API endpoints (payments, customers, etc.)
- Implement pagination for large result sets
- Add configuration file support
- Add interactive mode
- Add webhook management commands
- Add data export functionality

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

- **Module not found errors**: Run `npm install` first
- **Permission denied**: Make sure `bin/stripe-cli.js` is executable
- **Invalid API key**: Ensure key starts with `sk_` or `rk_`
- **No accounts found**: Check if you have Connect accounts in your Stripe dashboard
- **API parameter errors**: Always verify parameters against official Stripe documentation
