const { searchAccounts } = require('../lib/commands/account');
const { createStripeClient, getStripeKey } = require('../lib/stripe-client');

// Mock the stripe-client module
jest.mock('../lib/stripe-client');

describe('Account Search Functionality', () => {
  let mockStripe;
  let consoleSpy;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Mock Stripe client
    mockStripe = {
      accounts: {
        list: jest.fn()
      }
    };

    createStripeClient.mockReturnValue(mockStripe);
    getStripeKey.mockReturnValue('sk_test_1234567890abcdef');
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('Basic Search Functionality', () => {
    test('should search accounts with fuzzy matching', async () => {
      const mockAccounts = {
        data: [
          {
            id: 'acct_123',
            email: 'test@example.com',
            business_profile: {
              name: 'Test Veterinary Clinic',
              dba: 'Test Vet'
            },
            settings: {
              dashboard: {
                display_name: 'Test Clinic'
              }
            },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          },
          {
            id: 'acct_456',
            email: 'other@example.com',
            business_profile: {
              name: 'Other Business',
              dba: 'Other'
            },
            settings: {
              dashboard: {
                display_name: 'Other Business'
              }
            },
            country: 'US',
            type: 'standard',
            charges_enabled: false,
            payouts_enabled: false,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await searchAccounts(options);

      expect(mockStripe.accounts.list).toHaveBeenCalledWith({ limit: 100 });
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Searching Connect accounts...'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 account(s) matching "test"'));
    });

    test('should handle wildcard search with *', async () => {
      const mockAccounts = {
        data: [
          {
            id: 'acct_123',
            email: 'veterinary@example.com',
            business_profile: {
              name: 'Veterinary Clinic',
              dba: 'Vet Services'
            },
            settings: {
              dashboard: {
                display_name: 'Vet Clinic'
              }
            },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          },
          {
            id: 'acct_456',
            email: 'other@example.com',
            business_profile: {
              name: 'Other Business',
              dba: 'Other'
            },
            settings: {
              dashboard: {
                display_name: 'Other Business'
              }
            },
            country: 'US',
            type: 'standard',
            charges_enabled: false,
            payouts_enabled: false,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: '*vet*',
        format: 'table'
      };

      await searchAccounts(options);

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 account(s) matching "*vet*"'));
    });

    test('should return JSON format when requested', async () => {
      const mockAccounts = {
        data: [
          {
            id: 'acct_123',
            email: 'test@example.com',
            business_profile: {
              name: 'Test Veterinary Clinic'
            },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: 'test',
        format: 'json'
      };

      await searchAccounts(options);

      expect(consoleSpy.log).toHaveBeenCalledWith(JSON.stringify([mockAccounts.data[0]], null, 2));
    });

    test('should handle no search results', async () => {
      const mockAccounts = {
        data: [
          {
            id: 'acct_123',
            email: 'other@example.com',
            business_profile: {
              name: 'Other Business'
            },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: 'nonexistent',
        format: 'table'
      };

      await searchAccounts(options);

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('No accounts found matching "nonexistent"'));
    });

    test('should handle no accounts at all', async () => {
      const mockAccounts = {
        data: [],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await searchAccounts(options);

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('No Connect accounts found.'));
    });
  });

  describe('Pagination Handling', () => {
    test('should handle paginated results', async () => {
      const firstPage = {
        data: [
          {
            id: 'acct_123',
            email: 'test1@example.com',
            business_profile: { name: 'Test Clinic 1' },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          }
        ],
        has_more: true
      };

      const secondPage = {
        data: [
          {
            id: 'acct_456',
            email: 'test2@example.com',
            business_profile: { name: 'Test Clinic 2' },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await searchAccounts(options);

      expect(mockStripe.accounts.list).toHaveBeenCalledTimes(2);
      expect(mockStripe.accounts.list).toHaveBeenNthCalledWith(1, { limit: 100 });
      expect(mockStripe.accounts.list).toHaveBeenNthCalledWith(2, { 
        limit: 100, 
        starting_after: 'acct_123' 
      });
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 account(s) matching "test"'));
    });
  });

  describe('Search Fields', () => {
    test('should search across multiple fields', async () => {
      const mockAccounts = {
        data: [
          {
            id: 'acct_123',
            email: 'veterinary@example.com',
            business_profile: {
              name: 'Veterinary Clinic',
              dba: 'Vet Services'
            },
            settings: {
              dashboard: {
                display_name: 'Vet Clinic'
              }
            },
            metadata: {
              name: 'Vet Business',
              dba: 'Vet DBA',
              descriptor: 'Vet Descriptor'
            },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: 'vet',
        format: 'table'
      };

      await searchAccounts(options);

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 account(s) matching "vet"'));
    });
  });

  describe('Error Handling', () => {
    test('should handle Stripe authentication errors', async () => {
      const authError = new Error('Invalid API key');
      authError.type = 'StripeAuthenticationError';
      mockStripe.accounts.list.mockRejectedValue(authError);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await expect(searchAccounts(options)).rejects.toThrow('Invalid Stripe API key. Please check your API key.');
    });

    test('should handle Stripe permission errors', async () => {
      const permissionError = new Error('Insufficient permissions');
      permissionError.type = 'StripePermissionError';
      mockStripe.accounts.list.mockRejectedValue(permissionError);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await expect(searchAccounts(options)).rejects.toThrow('Insufficient permissions. Make sure your API key has the required permissions.');
    });

    test('should handle Stripe API errors', async () => {
      const apiError = new Error('API error');
      apiError.type = 'StripeAPIError';
      mockStripe.accounts.list.mockRejectedValue(apiError);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await expect(searchAccounts(options)).rejects.toThrow('Stripe API error: API error');
    });

    test('should handle general errors', async () => {
      const generalError = new Error('Network error');
      mockStripe.accounts.list.mockRejectedValue(generalError);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await expect(searchAccounts(options)).rejects.toThrow('Failed to search accounts: Network error');
    });
  });

  describe('Table Formatting', () => {
    test('should format table with correct columns', async () => {
      const mockAccounts = {
        data: [
          {
            id: 'acct_123',
            email: 'test@example.com',
            business_profile: {
              name: 'Test Veterinary Clinic',
              dba: 'Test Vet'
            },
            settings: {
              dashboard: {
                display_name: 'Test Clinic'
              }
            },
            country: 'US',
            type: 'standard',
            charges_enabled: true,
            payouts_enabled: true,
            created: 1640995200
          }
        ],
        has_more: false
      };

      mockStripe.accounts.list.mockResolvedValue(mockAccounts);

      const options = {
        searchTerm: 'test',
        format: 'table'
      };

      await searchAccounts(options);

      // Check that table headers are included
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('ID'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Email'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Business Name'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('DBA'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Display Name'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Country'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Type'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Charges Enabled'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Payouts Enabled'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Created'));
    });
  });
});
