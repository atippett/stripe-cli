# Testing Guide

This directory contains comprehensive tests for the Stripe CLI tool.

## Test Structure

```
__tests__/
├── setup.js                    # Jest setup and global configuration
├── utils/
│   └── test-helpers.js         # Test utilities and mock data
├── fixtures/                   # Test data files
│   ├── valid-cards.csv         # Valid card data for testing
│   ├── invalid-cards.csv       # Invalid card data for testing
│   └── test-profile.profile    # Test secrets configuration
├── cards.test.js               # Card import functionality tests
├── profile-manager.test.js     # Profile management tests
├── stripe-client.test.js       # Stripe client tests
└── cli.integration.test.js     # CLI integration tests
```

## Running Tests

### Local Development

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test cards.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="validation"
```

### CI/CD

```bash
# Run tests for CI (no watch mode, with coverage)
npm run test:ci
```

## Test Categories

### Unit Tests
- **cards.test.js**: Tests card validation, CSV parsing, and Stripe integration
- **profile-manager.test.js**: Tests profile loading, validation, and key retrieval
- **stripe-client.test.js**: Tests Stripe client creation and API key handling

### Integration Tests
- **cli.integration.test.js**: Tests CLI command structure, help output, and error handling

## Test Data

### Card Data
- **Valid cards**: Test data with proper card numbers, expiration dates, and optional fields
- **Invalid cards**: Test data with various validation errors (invalid Luhn, past dates, missing fields)

### Profile Data
- **Valid profiles**: Test profile configurations with proper API keys
- **Invalid profiles**: Test profile configurations with invalid keys or missing data

## Mocking

Tests use Jest mocking to:
- Mock Stripe API calls with `nock`
- Mock file system operations
- Mock console output
- Mock external dependencies

## Coverage

The test suite aims for:
- **Statements**: >90%
- **Branches**: >85%
- **Functions**: >90%
- **Lines**: >90%

## Writing New Tests

### Test File Structure
```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('Sub-feature', () => {
    test('should do something specific', () => {
      // Test implementation
    });
  });
});
```

### Best Practices
1. **Descriptive test names**: Use clear, descriptive test names
2. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification
3. **Mock external dependencies**: Don't make real API calls in tests
4. **Clean up resources**: Remove temporary files and reset mocks
5. **Test edge cases**: Include tests for error conditions and edge cases

### Example Test
```javascript
test('should validate card number using Luhn algorithm', () => {
  // Arrange
  const validCard = '4242424242424242';
  const invalidCard = '1234567890123456';

  // Act & Assert
  expect(validateCardNumber(validCard)).toBe(true);
  expect(validateCardNumber(invalidCard)).toBe(false);
});
```

## Continuous Integration

Tests run automatically on:
- **Push to main/master/develop branches**
- **Pull requests**
- **Multiple Node.js versions** (14.x, 16.x, 18.x, 20.x)

### GitHub Actions
- **Test job**: Runs tests across multiple Node.js versions
- **Security job**: Runs security audits and vulnerability checks
- **Build job**: Tests CLI build and help commands

## Debugging Tests

### Running Individual Tests
```bash
# Run specific test
npm test -- --testNamePattern="should validate card number"

# Run tests in specific file
npm test cards.test.js

# Run tests with verbose output
npm test -- --verbose
```

### Debug Mode
```bash
# Run tests with Node.js debugger
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Performance

- Tests should complete in under 30 seconds
- Use `--runInBand` for debugging to avoid parallel execution issues
- Mock external API calls to avoid network dependencies
