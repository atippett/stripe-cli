# Stripe API Integration Testing Guide

This guide explains how to set up and run integration tests that use real Stripe API calls with test keys.

## 🎯 Overview

Integration tests provide comprehensive validation by making actual API calls to Stripe's test environment. This ensures that:

- Real API responses are handled correctly
- Network issues are caught early
- Rate limiting behavior is tested
- Actual data validation occurs
- End-to-end workflows function properly

## 🔑 Prerequisites

### 1. Stripe Test Key

You need a Stripe test API key to run integration tests. You have three options:

**Option 1: Environment Variable**
```bash
export STRIPE_TEST_KEY=sk_test_your_actual_test_key_here
```

**Option 2: Profile Configuration (Recommended)**
Configure your test platform in `config.yml`:
```yaml
global:
  default_platform: "vet"
  test_platform: "vet"

platform:
  vet:
    account: "acct_18yYltEdgy9m3MPr"
    test_connected_account: "acct_1Rw31tRLzvnMBwNL"
```

And add test keys to your `.secrets` file:
```ini
[vet]
test_restricted_key=rk_test_your_actual_test_key_here
test_secret_key=sk_test_your_actual_test_secret_key_here
```

**Option 3: .env File**
```bash
echo "STRIPE_TEST_KEY=sk_test_your_actual_test_key_here" >> .env
```

The system will automatically detect and use the test key from any of these sources.

### 2. Environment Setup

```bash
# Install dependencies
npm install

# Run the setup script
./scripts/setup-test-env.sh
```

## 🧪 Running Integration Tests

### Local Development

```bash
# Run integration tests only
npm run test:integration

# Run all tests (unit + integration)
npm test

# Run with coverage
npm run test:coverage
```

### CI/CD Environment

Integration tests run automatically in GitHub Actions when:
- A `STRIPE_TEST_KEY` secret is configured
- Tests are triggered by push/PR events
- Manual workflow dispatch is used

## 📊 Test Categories

### 1. Account Management Tests
- **List Connect accounts**: Tests account listing functionality
- **Invalid API key handling**: Validates error handling for bad keys
- **Network error handling**: Tests resilience to network issues

### 2. Card Import Integration Tests
- **Real token creation**: Creates actual Stripe tokens for test cards
- **Connected account integration**: Tests with real Stripe accounts
- **Validation with real API**: Uses Stripe's actual validation
- **Error handling**: Tests declined cards and API errors

### 3. Stripe Client Tests
- **Client creation**: Validates Stripe client initialization
- **Key retrieval**: Tests environment variable handling
- **Priority handling**: Tests key precedence (--key > --profile > env)

### 4. Data Validation Tests
- **Real card validation**: Tests against Stripe's actual validation
- **Test card scenarios**: Uses Stripe's test card numbers
- **Declined card handling**: Tests error scenarios

## 🃏 Test Card Data

Integration tests use Stripe's official test card numbers:

### Valid Test Cards
| Card Number | Brand | Description |
|-------------|-------|-------------|
| `4242424242424242` | Visa | Generic successful card |
| `5555555555554444` | Mastercard | Generic successful card |
| `378282246310005` | American Express | Generic successful card |
| `6011111111111117` | Discover | Generic successful card |

### Declined Test Cards
| Card Number | Reason | Description |
|-------------|--------|-------------|
| `4000000000000002` | Generic decline | Card declined |
| `4000000000000069` | Expired card | Card has expired |
| `4000000000000119` | Processing error | Processing error |
| `4000000000000127` | Incorrect CVC | CVC check failed |

## 🔧 Configuration

### Environment Variables

```bash
# Required for integration tests
STRIPE_TEST_KEY=sk_test_your_test_key_here

# Optional
STRIPE_DEFAULT_PROFILE=test
```

### Test Configuration

Integration tests are configured in `jest.config.js`:

```javascript
{
  displayName: 'integration',
  testMatch: ['<rootDir>/__tests__/stripe-integration.test.js'],
  testTimeout: 60000, // Longer timeout for API calls
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js']
}
```

## 🛡️ Security Considerations

### Test Key Safety
- **Never commit test keys**: Use environment variables or secrets
- **Use test keys only**: Never use live keys in tests
- **Rotate keys regularly**: Update test keys periodically
- **Limit permissions**: Use restricted keys when possible

### GitHub Actions Secrets
1. Go to your repository settings
2. Navigate to "Secrets and variables" > "Actions"
3. Add `STRIPE_TEST_KEY` as a repository secret
4. Use the secret in workflow files

## 📈 Test Results

### Success Indicators
- ✅ All API calls succeed
- ✅ Test data is created and cleaned up
- ✅ Error scenarios are handled correctly
- ✅ Rate limiting is respected

### Common Issues

#### 1. Invalid Test Key
```
Error: Invalid Stripe API key
```
**Solution**: Verify your test key is correct and starts with `sk_test_`

#### 2. Network Timeouts
```
Error: Request timeout
```
**Solution**: Check your internet connection and Stripe's status

#### 3. Rate Limiting
```
Error: Too many requests
```
**Solution**: Tests include delays to respect rate limits

#### 4. Test Account Issues
```
Error: Account not found
```
**Solution**: Tests create temporary accounts and clean them up

## 🔄 Test Lifecycle

### Setup Phase
1. Validate test key format
2. Create Stripe client
3. Generate test data files
4. Set up test accounts

### Execution Phase
1. Run API integration tests
2. Validate responses
3. Test error scenarios
4. Verify data integrity

### Cleanup Phase
1. Delete test accounts
2. Remove temporary files
3. Clear test data
4. Generate reports

## 📋 Best Practices

### Test Design
- **Isolate tests**: Each test should be independent
- **Clean up resources**: Always clean up test data
- **Handle errors gracefully**: Test both success and failure cases
- **Use realistic data**: Test with real-world scenarios

### Performance
- **Respect rate limits**: Add delays between requests
- **Use timeouts**: Set appropriate timeouts for API calls
- **Batch operations**: Group related tests when possible
- **Monitor costs**: Test keys have usage limits

### Maintenance
- **Update test data**: Keep test cards and scenarios current
- **Monitor Stripe changes**: Update tests when API changes
- **Review test results**: Analyze failures and improve tests
- **Document changes**: Update this guide when tests change

## 🚀 Advanced Usage

### Custom Test Scenarios

Create custom test scenarios by extending the test environment:

```javascript
// Custom test data
const customTestCards = [
  { number: '4242424242424242', exp: '12/25', first: 'Custom', last: 'Test' }
];

// Create custom CSV
const csvPath = createTestCsvFile('custom_test.csv', customTestCards);

// Run custom test
const options = {
  file: csvPath,
  account: testAccountId,
  key: STRIPE_TEST_KEY,
  dryRun: false
};

await importCards(options);
```

### Parallel Testing

Run multiple test scenarios in parallel:

```javascript
test('parallel card validation', async () => {
  const promises = testCards.map(card => 
    stripe.tokens.create({
      card: {
        number: card.number,
        exp_month: 12,
        exp_year: 2025
      }
    })
  );
  
  const results = await Promise.allSettled(promises);
  // Process results...
});
```

## 📚 Resources

### Stripe Documentation
- [Stripe Test Cards](https://stripe.com/docs/testing#cards)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Testing Guide](https://stripe.com/docs/testing)

### Test Tools
- [Stripe Dashboard](https://dashboard.stripe.com/test)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)
- [Stripe Webhooks Testing](https://stripe.com/docs/webhooks/test)

### Support
- [Stripe Support](https://support.stripe.com/)
- [Stripe Community](https://github.com/stripe/stripe-node)
- [Test Environment Issues](https://github.com/your-repo/issues)

---

**Note**: Integration tests provide valuable validation but should be used alongside unit tests for comprehensive coverage. Always use test keys and never commit sensitive data to version control.
