const fs = require('fs');
const path = require('path');
const nock = require('nock');
const { importCards } = require('../lib/commands/cards');
const { getPlatformAccount, getPlatformTestConnectedAccount, getTestProfile } = require('../lib/config-loader');

// Mock the Stripe client
jest.mock('../lib/stripe-client', () => ({
  createStripeClient: jest.fn(() => ({
    customers: {
      create: jest.fn()
    },
    paymentMethods: {
      create: jest.fn()
    },
    setupIntents: {
      create: jest.fn()
    }
  })),
  getStripeKey: jest.fn(() => 'sk_test_mock_key')
}));

describe('Card Import Functionality', () => {
  let mockStripe;
  let testCsvFile;
  let testPlatformAccount;
  let testConnectedAccount;

  beforeAll(() => {
    // Get test accounts from configuration
    const testProfile = getTestProfile();
    testPlatformAccount = getPlatformAccount(testProfile);
    testConnectedAccount = getPlatformTestConnectedAccount(testProfile);
    
    console.log(`🧪 Running tests with platform: ${testProfile}`);
    console.log(`🏢 Platform account: ${testPlatformAccount}`);
    console.log(`🔗 Connected account: ${testConnectedAccount}`);
  });

  beforeEach(() => {
    // Create a temporary CSV file for testing
    testCsvFile = path.join(process.cwd(), 'tmp', 'temp_test_cards.csv');
    const csvContent = `card,exp,first,last,zip,token
4242424242424242,12/25,John,Doe,12345,
5555555555554444,0626,Jane,Smith,67890,
4000000000000002,03/27,,,54321,
4111111111111111,12/26,Alice,,,`;

    fs.writeFileSync(testCsvFile, csvContent);

    // Mock Stripe API responses
    mockStripe = {
      customers: {
        create: jest.fn()
      },
      paymentMethods: {
        create: jest.fn()
      },
      setupIntents: {
        create: jest.fn()
      }
    };

    const { createStripeClient } = require('../lib/stripe-client');
    createStripeClient.mockReturnValue(mockStripe);
  });

  afterEach(() => {
    // Clean up temporary file
    if (fs.existsSync(testCsvFile)) {
      fs.unlinkSync(testCsvFile);
    }
    jest.clearAllMocks();
  });

  describe('CSV Validation', () => {
    test('should validate valid card numbers', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        dryRun: true
      };

      // Mock successful Stripe responses
      mockStripe.customers.create.mockResolvedValue({
        id: 'cus_test123'
      });
      mockStripe.paymentMethods.create.mockResolvedValue({
        id: 'pm_test123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025
        }
      });
      mockStripe.setupIntents.create.mockResolvedValue({
        id: 'seti_test123',
        status: 'succeeded',
        payment_method: 'pm_test123'
      });

      await expect(importCards(options)).resolves.not.toThrow();
    });

    test('should reject invalid card numbers', async () => {
      const invalidCsvFile = path.join(process.cwd(), 'tmp', 'temp_invalid_cards.csv');
      const invalidCsvContent = `card,exp,first,last,zip,token
1234567890123456,12/25,John,Doe,12345,
4242424242424242,13/25,Jane,Smith,67890,`;

      fs.writeFileSync(invalidCsvFile, invalidCsvContent);

      const options = {
        file: invalidCsvFile,
        account: testPlatformAccount,
        dryRun: true
      };

      // Should throw error because no valid cards found
      await expect(importCards(options)).rejects.toThrow('No valid cards found to import');

      // Clean up
      fs.unlinkSync(invalidCsvFile);
    });

    test('should handle missing required fields', async () => {
      const missingFieldsCsvFile = path.join(process.cwd(), 'tmp', 'temp_missing_fields.csv');
      const missingFieldsContent = `card,exp,first,last,zip,token
,12/25,John,Doe,12345,
4242424242424242,,Jane,Smith,67890,`;

      fs.writeFileSync(missingFieldsCsvFile, missingFieldsContent);

      const options = {
        file: missingFieldsCsvFile,
        account: testPlatformAccount,
        dryRun: true
      };

      // Should throw error because no valid cards found
      await expect(importCards(options)).rejects.toThrow('No valid cards found to import');

      // Clean up
      fs.unlinkSync(missingFieldsCsvFile);
    });
  });

  describe('Stripe Integration', () => {
    test('should create Stripe customers, payment methods, and setup intents for valid cards', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        dryRun: false
      };

      // Mock successful Stripe responses
      mockStripe.customers.create.mockResolvedValue({
        id: 'cus_test123'
      });
      mockStripe.paymentMethods.create.mockResolvedValue({
        id: 'pm_test123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025
        }
      });
      mockStripe.setupIntents.create.mockResolvedValue({
        id: 'seti_test123',
        status: 'succeeded',
        payment_method: 'pm_test123'
      });

      await importCards(options);

      expect(mockStripe.customers.create).toHaveBeenCalled();
      expect(mockStripe.paymentMethods.create).toHaveBeenCalled();
      expect(mockStripe.setupIntents.create).toHaveBeenCalled();
    });

    test('should handle Stripe API errors gracefully', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        dryRun: false
      };

      // Mock Stripe API error
      const stripeError = new Error('Invalid card number');
      stripeError.type = 'StripeAPIError';
      mockStripe.customers.create.mockRejectedValue(stripeError);

      await expect(importCards(options)).resolves.not.toThrow();
    });
  });

  describe('Output Generation', () => {
    test('should generate output CSV file', async () => {
      const outputFile = path.join(process.cwd(), 'tmp', 'temp_output.csv');
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        output: outputFile,
        dryRun: false
      };

      // Mock successful Stripe responses
      mockStripe.customers.create.mockResolvedValue({
        id: 'cus_test123'
      });
      mockStripe.paymentMethods.create.mockResolvedValue({
        id: 'pm_test123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025
        }
      });
      mockStripe.setupIntents.create.mockResolvedValue({
        id: 'seti_test123',
        status: 'succeeded',
        payment_method: 'pm_test123'
      });

      await importCards(options);

      expect(fs.existsSync(outputFile)).toBe(true);

      // Clean up
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    });
  });

  describe('Command Options', () => {
    test('should handle dry-run mode', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        dryRun: true
      };

      await importCards(options);

      // In dry-run mode, Stripe API should not be called
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(mockStripe.paymentMethods.create).not.toHaveBeenCalled();
      expect(mockStripe.setupIntents.create).not.toHaveBeenCalled();
    });

    test('should handle verbose mode', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        verbose: true,
        dryRun: true
      };

      await expect(importCards(options)).resolves.not.toThrow();
    });

    test('should handle custom delimiter', async () => {
      const semicolonCsvFile = path.join(process.cwd(), 'tmp', 'temp_semicolon.csv');
      const semicolonContent = `card;exp;first;last;zip;token
4242424242424242;12/25;John;Doe;12345;
5555555555554444;0626;Jane;Smith;67890;`;

      fs.writeFileSync(semicolonCsvFile, semicolonContent);

      const options = {
        file: semicolonCsvFile,
        account: testPlatformAccount,
        delimiter: ';',
        dryRun: true
      };

      await expect(importCards(options)).resolves.not.toThrow();

      // Clean up
      fs.unlinkSync(semicolonCsvFile);
    });
  });

  describe('Account Configuration', () => {
    test('should use connected account when provided', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        connectedAccount: testConnectedAccount,
        dryRun: true
      };

      // Mock successful Stripe responses
      mockStripe.customers.create.mockResolvedValue({
        id: 'cus_test123'
      });
      mockStripe.paymentMethods.create.mockResolvedValue({
        id: 'pm_test123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025
        }
      });
      mockStripe.setupIntents.create.mockResolvedValue({
        id: 'seti_test123',
        status: 'succeeded',
        payment_method: 'pm_test123'
      });

      await expect(importCards(options)).resolves.not.toThrow();
    });

    test('should fall back to platform account when no connected account provided', async () => {
      const options = {
        file: testCsvFile,
        account: testPlatformAccount,
        dryRun: true
      };

      // Mock successful Stripe responses
      mockStripe.customers.create.mockResolvedValue({
        id: 'cus_test123'
      });
      mockStripe.paymentMethods.create.mockResolvedValue({
        id: 'pm_test123',
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2025
        }
      });
      mockStripe.setupIntents.create.mockResolvedValue({
        id: 'seti_test123',
        status: 'succeeded',
        payment_method: 'pm_test123'
      });

      await expect(importCards(options)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing file', async () => {
      const options = {
        file: 'nonexistent.csv',
        account: testPlatformAccount
      };

      await expect(importCards(options)).rejects.toThrow('CSV file not found');
    });

    test('should handle missing account parameter', async () => {
      // Mock ProfileManager to not return a default profile
      const ProfileManager = require('../lib/profile-manager');
      const originalGetDefaultProfile = ProfileManager.prototype.getDefaultProfile;
      ProfileManager.prototype.getDefaultProfile = jest.fn().mockReturnValue(null);

      const options = {
        file: testCsvFile
      };

      await expect(importCards(options)).rejects.toThrow('Platform account ID is required');

      // Restore original method
      ProfileManager.prototype.getDefaultProfile = originalGetDefaultProfile;
    });

    test('should handle empty CSV file', async () => {
      const emptyCsvFile = path.join(process.cwd(), 'tmp', 'temp_empty.csv');
      fs.writeFileSync(emptyCsvFile, '');

      const options = {
        file: emptyCsvFile,
        account: testPlatformAccount
      };

      await expect(importCards(options)).rejects.toThrow('No data found in CSV file');

      // Clean up
      fs.unlinkSync(emptyCsvFile);
    });
  });
});
