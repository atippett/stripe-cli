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
- Test account settings: `node bin/stripe-cli.js account settings --help`
- Test network cost passthrough: `node bin/stripe-cli.js account settings network-costs --help`

## API Key Configuration

- Supports both secret keys (`sk_`) and restricted keys (`rk_`)
- Multiple configuration methods with priority order:
  1. `--key` option (highest priority)
  2. `--profile` option
  3. Default profile from `.profile` file
  4. `STRIPE_SECRET_KEY` environment variable (lowest priority)
- Profile management via `.profile` configuration file
- Validation ensures keys start with `sk_` or `rk_`
- Clear error messages for authentication issues

### Profile Configuration

Create a `.profile` file in the project root:

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

### Profile Commands

- `stripe-cli profile list` - List all configured profiles
- `stripe-cli account list -p profileName` - Use specific profile
- `stripe-cli account list` - Use default profile

### Account Settings Commands

- `stripe-cli account settings network-costs enable -a acct_123` - Enable network cost passthrough
- `stripe-cli account settings network-costs disable -a acct_123` - Disable network cost passthrough
- `stripe-cli account settings network-costs status -a acct_123` - Check network cost passthrough status
- `stripe-cli account settings network-costs delete-scheme -a acct_123 --scheme-id pcsch_123` - Delete scheduled scheme

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
- [Stripe Dashboard](https://dashboard.stripe.com) - Web interface for account management

## Common Issues

- **Module not found errors**: Run `npm install` first
- **Permission denied**: Make sure `bin/stripe-cli.js` is executable
- **Invalid API key**: Ensure key starts with `sk_` or `rk_`
- **No accounts found**: Check if you have Connect accounts in your Stripe dashboard
