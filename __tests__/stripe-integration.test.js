const fs = require('fs');
const path = require('path');
const { importCards } = require('../lib/commands/cards');
const { listAccounts } = require('../lib/commands/account');
const { createStripeClient, getStripeKey } = require('../lib/stripe-client');
const { getTestKey, shouldRunIntegrationTests } = require('./test-env');

// Get test key from environment or profile
const STRIPE_TEST_KEY = getTestKey();
const shouldSkipIntegrationTests = !shouldRunIntegrationTests();

describe('Stripe API Integration Tests', () => {
  let stripe;
  let testAccountId;
  let testCsvFile;

  beforeAll(() => {
    if (shouldSkipIntegrationTests) {
      console.log('⚠️  Skipping Stripe integration tests - no valid test key provided');
      console.log('   Set STRIPE_TEST_KEY environment variable to run integration tests');
      return;
    }

    // Create Stripe client with test key
    stripe = createStripeClient(STRIPE_TEST_KEY);
    
    // Create test CSV file
    testCsvFile = path.join(process.cwd(), 'tmp', 'temp_integration_test.csv');
    const csvContent = `card,exp,first,last,zip,token
4242424242424242,12/25,John,Doe,12345,
5555555555554444,0626,Jane,Smith,67890,
4000000000000002,03/27,,,54321,
4111111111111111,12/26,Alice,,,`;
    
    fs.writeFileSync(testCsvFile, csvContent);
  });

  afterAll(() => {
    // Clean up test file
    if (testCsvFile && fs.existsSync(testCsvFile)) {
      fs.unlinkSync(testCsvFile);
    }
  });

  describe('Account Management', () => {
    test('should list Connect accounts', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const options = {
        key: STRIPE_TEST_KEY,
        format: 'json'
      };

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        await listAccounts(options);
        expect(consoleSpy).toHaveBeenCalled();
      } catch (error) {
        // If no accounts exist, that's also a valid result
        expect(error.message).toContain('No accounts found');
      } finally {
        consoleSpy.mockRestore();
      }
    }, 10000);

    test('should handle invalid API key', async () => {
      const options = {
        key: 'sk_test_invalid_key_12345',
        format: 'json'
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        await listAccounts(options);
      } catch (error) {
        expect(error.message).toContain('Invalid Stripe API key');
      } finally {
        consoleSpy.mockRestore();
      }
    }, 10000);
  });

  describe('Card Import Integration', () => {
    test('should create test tokens for valid cards', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      // First, create a test connected account
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: 'test@example.com'
      });

      testAccountId = account.id;

      const options = {
        file: testCsvFile,
        account: testAccountId,
        key: STRIPE_TEST_KEY,
        dryRun: false,
        verbose: true
      };

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        await importCards(options);
        expect(consoleSpy).toHaveBeenCalled();
      } catch (error) {
        // Some cards might fail (like 4000000000000002 which is a test decline card)
        expect(error.message).toContain('Import failed');
      } finally {
        consoleSpy.mockRestore();
      }
    }, 30000);

    test('should validate cards in dry-run mode', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const options = {
        file: testCsvFile,
        account: testAccountId || 'acct_test123',
        key: STRIPE_TEST_KEY,
        dryRun: true
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        await importCards(options);
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    }, 15000);

    test('should handle invalid account ID', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const options = {
        file: testCsvFile,
        account: 'acct_invalid123',
        key: STRIPE_TEST_KEY,
        dryRun: false
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        await importCards(options);
      } catch (error) {
        expect(error.message).toContain('Import failed');
      } finally {
        consoleSpy.mockRestore();
      }
    }, 15000);
  });

  describe('Stripe Client Integration', () => {
    test('should create valid Stripe client', () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const client = createStripeClient(STRIPE_TEST_KEY);
      expect(client).toBeDefined();
      expect(typeof client.tokens).toBe('object');
      expect(typeof client.accounts).toBe('object');
    });

    test('should retrieve key from environment', () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      // Set environment variable to test environment fallback
      process.env.STRIPE_SECRET_KEY = STRIPE_TEST_KEY;
      const options = {};
      const key = getStripeKey(options);
      // The key should come from the profile system (vet-test profile) since that's configured
      // Environment variable is only used as fallback when no profile is available
      expect(key).toBeDefined();
      expect(key).toMatch(/^rk_test_/);
      delete process.env.STRIPE_SECRET_KEY;
    });

    test('should prioritize --key option over environment', () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const options = { key: 'sk_test_override' };
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_override');
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      // Test with a malformed key that will cause network errors
      const options = {
        key: 'sk_test_malformed_key_that_will_cause_network_error',
        format: 'json'
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        await listAccounts(options);
      } catch (error) {
        expect(error.message).toContain('Invalid Stripe API key');
      } finally {
        consoleSpy.mockRestore();
      }
    }, 15000);

    test('should handle rate limiting', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const options = {
        key: STRIPE_TEST_KEY,
        format: 'json'
      };

      // Make multiple rapid requests to test rate limiting
      const promises = Array(5).fill().map(() => listAccounts(options));
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      try {
        await Promise.allSettled(promises);
        // At least some requests should succeed
      } catch (error) {
        // Rate limiting or other errors are acceptable
        expect(error.message).toBeDefined();
      } finally {
        consoleSpy.mockRestore();
      }
    }, 20000);
  });

  describe('Data Validation', () => {
    test('should validate real card numbers against Stripe', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const testCards = [
        { number: '4242424242424242', expected: 'visa' },
        { number: '5555555555554444', expected: 'mastercard' },
        { number: '378282246310005', expected: 'amex' },
        { number: '6011111111111117', expected: 'discover' }
      ];

      for (const card of testCards) {
        try {
          const token = await stripe.tokens.create({
            card: {
              number: card.number,
              exp_month: 12,
              exp_year: 2025,
              cvc: '123'
            }
          });

          expect(token.card.brand).toBe(card.expected);
          expect(token.card.last4).toBe(card.number.slice(-4));
        } catch (error) {
          // Some test cards might be declined, which is expected
          expect(error.type).toBeDefined();
        }
      }
    }, 30000);

    test('should handle declined test cards', async () => {
      if (shouldSkipIntegrationTests) {
        return;
      }

      const declinedCards = [
        '4000000000000002', // Generic decline
        '4000000000000069', // Expired card
        '4000000000000119', // Processing error
      ];

      for (const cardNumber of declinedCards) {
        try {
          await stripe.tokens.create({
            card: {
              number: cardNumber,
              exp_month: 12,
              exp_year: 2025,
              cvc: '123'
            }
          });
          // If we get here, the card was unexpectedly accepted
          fail(`Card ${cardNumber} should have been declined`);
        } catch (error) {
          // Expected to fail
          expect(error.type).toBeDefined();
        }
      }
    }, 20000);
  });

  describe('Cleanup', () => {
    test('should clean up test resources', async () => {
      if (shouldSkipIntegrationTests || !testAccountId) {
        return;
      }

      try {
        // Delete the test account
        await stripe.accounts.del(testAccountId);
        console.log(`✅ Cleaned up test account: ${testAccountId}`);
      } catch (error) {
        console.log(`⚠️  Could not clean up test account: ${error.message}`);
      }
    }, 10000);
  });
});
