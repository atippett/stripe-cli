# Testing Guide for Stripe CLI

This document provides a comprehensive guide to the testing setup for the Stripe CLI tool.

## 🧪 Test Overview

The project includes a complete testing framework with:
- **57 passing tests** across 4 test suites
- **Unit tests** for core functionality
- **Integration tests** for CLI commands
- **GitHub Actions** for automated testing
- **Coverage reporting** with detailed metrics

## 📊 Test Coverage

Current coverage metrics:
- **Statements**: 51.58%
- **Branches**: 57.66%
- **Functions**: 58.06%
- **Lines**: 51.5%

### Coverage by Module:
- **lib/profile-manager.js**: 94.8% statements, 96% lines
- **lib/stripe-client.js**: 95.23% statements, 95.23% lines
- **lib/commands/cards.js**: 87.09% statements, 88.51% lines
- **bin/stripe-cli**: 0% (CLI entry point, tested via integration tests)

## 🚀 Running Tests

### Local Development

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests for CI (no watch mode, with coverage)
npm run test:ci

# Run specific test file
npm test cards.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="validation"
```

### Test Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run all tests with Jest |
| `npm run test:watch` | Run tests in watch mode for development |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:ci` | Run tests for CI/CD (no watch, with coverage) |

## 📁 Test Structure

```
__tests__/
├── setup.js                    # Jest configuration and global setup
├── utils/
│   └── test-helpers.js         # Test utilities and mock data
├── fixtures/                   # Test data files
│   ├── valid-cards.csv         # Valid card data for testing
│   ├── invalid-cards.csv       # Invalid card data for testing
│   └── test-profile.profile    # Test secrets configuration
├── cards.test.js               # Card import functionality tests
├── profile-manager.test.js     # Profile management tests
├── stripe-client.test.js       # Stripe client tests
├── cli.integration.test.js     # CLI integration tests
└── README.md                   # Detailed testing documentation
```

## 🧩 Test Categories

### 1. Unit Tests

#### Profile Manager Tests (`profile-manager.test.js`)
- ✅ Profile loading from `.secrets` files
- ✅ Profile key retrieval and validation
- ✅ Default profile handling
- ✅ Error handling for missing/invalid profiles
- ✅ Edge cases (empty files, comments, etc.)

#### Stripe Client Tests (`stripe-client.test.js`)
- ✅ Stripe client creation with valid/invalid keys
- ✅ API key validation (sk_, rk_ prefixes)
- ✅ Key retrieval priority (--key > --profile > env var)
- ✅ Error handling for missing keys
- ✅ Profile integration

#### Card Import Tests (`cards.test.js`)
- ✅ CSV parsing and validation
- ✅ Luhn algorithm validation
- ✅ Expiration date validation
- ✅ Stripe token creation
- ✅ Output CSV generation
- ✅ Error handling and edge cases

### 2. Integration Tests

#### CLI Integration Tests (`cli.integration.test.js`)
- ✅ Help command output
- ✅ Command structure validation
- ✅ Error handling for missing parameters
- ✅ Option parsing
- ✅ Profile command integration

## 🔧 Test Configuration

### Jest Configuration (`jest.config.js`)
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: ['lib/**/*.js', 'bin/**/*.js'],
  coverageDirectory: 'coverage',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  testTimeout: 10000
};
```

### Test Setup (`__tests__/setup.js`)
- Global test configuration
- Console mocking to reduce noise
- Cleanup after each test
- Nock cleanup for HTTP mocking

## 🤖 Continuous Integration

### GitHub Actions Workflows

#### Test Workflow (`.github/workflows/test.yml`)
- **Triggers**: Push to main/master/develop, Pull requests
- **Node.js versions**: 14.x, 16.x, 18.x, 20.x
- **Jobs**:
  - **Test**: Runs tests across multiple Node.js versions
  - **Security**: Runs security audits and vulnerability checks
  - **Build**: Tests CLI build and help commands

#### Release Workflow (`.github/workflows/release.yml`)
- **Triggers**: Git tags (v*)
- **Actions**: Creates GitHub releases with changelog

## 📋 Test Data

### Card Test Data
- **Valid cards**: Test data with proper card numbers, expiration dates
- **Invalid cards**: Test data with validation errors
- **Edge cases**: Missing fields, malformed data

### Profile Test Data
- **Valid profiles**: Proper API key configurations
- **Invalid profiles**: Malformed keys, missing data
- **Edge cases**: Empty files, comments, special characters

## 🛠️ Mocking Strategy

### External Dependencies
- **Stripe API**: Mocked with `nock` for HTTP requests
- **File System**: Real file operations with cleanup
- **Console**: Mocked to reduce test output noise

### Test Utilities
- **createTempCsvFile()**: Creates temporary CSV files for testing
- **createTempProfileFile()**: Creates temporary profile files
- **removeTempFile()**: Cleans up temporary files
- **testCardData**: Predefined valid/invalid card data
- **mockStripeResponses**: Mock Stripe API responses

## 📈 Coverage Goals

### Current Status
- **Core modules**: 90%+ coverage achieved
- **CLI entry point**: Tested via integration tests
- **Command modules**: Partial coverage (account-settings.js, account.js not tested)

### Future Improvements
- Add tests for `account.js` and `account-settings.js`
- Increase CLI entry point coverage
- Add end-to-end tests with real Stripe API (sandbox)
- Add performance tests for large CSV imports

## 🐛 Debugging Tests

### Running Individual Tests
```bash
# Run specific test file
npm test cards.test.js

# Run specific test by name
npm test -- --testNamePattern="should validate card number"

# Run tests with verbose output
npm test -- --verbose

# Run tests in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Common Issues
1. **Timeout errors**: Increase timeout in test configuration
2. **Mock issues**: Ensure mocks are properly reset between tests
3. **File cleanup**: Use test utilities to manage temporary files
4. **Async tests**: Use proper async/await or done() callbacks

## 📚 Best Practices

### Writing Tests
1. **Descriptive names**: Use clear, descriptive test names
2. **Arrange-Act-Assert**: Structure tests with clear setup, execution, verification
3. **Mock external dependencies**: Don't make real API calls in tests
4. **Clean up resources**: Remove temporary files and reset mocks
5. **Test edge cases**: Include tests for error conditions

### Test Organization
1. **Group related tests**: Use `describe` blocks for logical grouping
2. **Setup/teardown**: Use `beforeEach`/`afterEach` for common setup
3. **Test data**: Use fixtures and utilities for consistent test data
4. **Mocking**: Mock at the right level (module vs function)

## 🔍 Quality Assurance

### Pre-commit Checks
- All tests must pass
- Coverage thresholds met
- No linting errors
- Security audit clean

### CI/CD Pipeline
- Tests run on multiple Node.js versions
- Security scanning
- Build verification
- Coverage reporting

## 📖 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Node.js Testing Guide](https://nodejs.org/en/docs/guides/testing/)

---

**Note**: This testing setup provides a solid foundation for maintaining code quality and preventing regressions. Regular test maintenance and updates are recommended as the codebase evolves.
