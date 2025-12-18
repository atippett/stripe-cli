const { createStripeClient, getStripeKey } = require('../lib/stripe-client');

// Mock the ProfileManager
const mockProfileManager = {
  loadProfiles: jest.fn(),
  getProfileKey: jest.fn()
};

jest.mock('../lib/profile-manager', () => {
  return jest.fn().mockImplementation(() => mockProfileManager);
});

describe('Stripe Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockProfileManager.loadProfiles.mockClear();
    mockProfileManager.getProfileKey.mockClear();
    mockProfileManager.loadProfiles.mockImplementation(() => {});
    mockProfileManager.getProfileKey.mockImplementation(() => 'sk_test_default');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createStripeClient', () => {
    test('should create Stripe client with valid secret key', () => {
      const client = createStripeClient('sk_test_1234567890abcdef');
      expect(client).toBeDefined();
      expect(typeof client.tokens).toBe('object');
    });

    test('should create Stripe client with valid restricted key', () => {
      const client = createStripeClient('rk_test_1234567890abcdef');
      expect(client).toBeDefined();
      expect(typeof client.tokens).toBe('object');
    });

    test('should throw error for missing API key', () => {
      expect(() => {
        createStripeClient();
      }).toThrow('Stripe secret key is required');
    });

    test('should throw error for invalid API key format', () => {
      expect(() => {
        createStripeClient('invalid_key');
      }).toThrow('Invalid Stripe API key format');
    });

    test('should throw error for empty API key', () => {
      expect(() => {
        createStripeClient('');
      }).toThrow('Stripe secret key is required');
    });
  });

  describe('getStripeKey', () => {
    test('should return key from --key option (highest priority)', () => {
      const options = { key: 'sk_test_from_option' };
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_from_option');
    });

    test('should return key from --platform option', () => {
      mockProfileManager.getProfileKey.mockReturnValue('sk_test_from_platform');

      const options = { platform: 'development' };
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_from_platform');
      expect(mockProfileManager.getProfileKey).toHaveBeenCalledWith('development');
    });

    test('should return key from default profile', () => {
      mockProfileManager.getProfileKey.mockReturnValue('sk_test_from_default');

      const options = {};
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_from_default');
      expect(mockProfileManager.getProfileKey).toHaveBeenCalledWith();
    });

    test('should return key from environment variable as fallback', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_from_env';
      mockProfileManager.loadProfiles.mockImplementation(() => {
        throw new Error('Profile file not found');
      });

      const options = {};
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_from_env');
    });

    test('should handle profile errors gracefully', () => {
      mockProfileManager.loadProfiles.mockImplementation(() => {
        throw new Error('Profile error');
      });

      process.env.STRIPE_SECRET_KEY = 'sk_test_fallback';

      const options = {};
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_fallback');
    });

    test('should return undefined when no key is available', () => {
      mockProfileManager.loadProfiles.mockImplementation(() => {
        throw new Error('Profile error');
      });

      delete process.env.STRIPE_SECRET_KEY;

      const options = {};
      const key = getStripeKey(options);
      expect(key).toBeUndefined();
    });

    test('should handle platform-specific key retrieval', () => {
      // Reset mocks to avoid interference from previous tests
      mockProfileManager.loadProfiles.mockClear();
      mockProfileManager.getProfileKey.mockClear();
      mockProfileManager.getProfileKey.mockReturnValue('sk_test_specific_platform');

      const options = { platform: 'production' };
      const key = getStripeKey(options);
      expect(key).toBe('sk_test_specific_platform');
      expect(mockProfileManager.getProfileKey).toHaveBeenCalledWith('production');
    });
  });

  describe('API Key Validation', () => {
    test('should accept valid secret keys', () => {
      const validKeys = [
        'sk_test_1234567890abcdef',
        'sk_live_1234567890abcdef',
        'sk_test_placeholderKeyForFormatValidationOnly' // use fake key in tests only
      ];

      validKeys.forEach(key => {
        expect(() => createStripeClient(key)).not.toThrow();
      });
    });

    test('should accept valid restricted keys', () => {
      const validKeys = [
        'rk_test_1234567890abcdef',
        'rk_live_1234567890abcdef'
      ];

      validKeys.forEach(key => {
        expect(() => createStripeClient(key)).not.toThrow();
      });
    });

    test('should reject invalid key formats', () => {
      const invalidKeys = [
        'pk_test_1234567890abcdef', // publishable key
        'test_1234567890abcdef', // missing prefix
      ];

      invalidKeys.forEach(key => {
        expect(() => createStripeClient(key)).toThrow('Invalid Stripe API key format');
      });
    });

    test('should accept short keys', () => {
      const shortKeys = [
        'sk_test', // short but valid
        'sk_test_', // short with underscore
      ];

      shortKeys.forEach(key => {
        expect(() => createStripeClient(key)).not.toThrow();
      });
    });

    test('should accept keys with various formats', () => {
      const validKeys = [
        'sk_invalid_1234567890abcdef', // valid format even with "invalid" in name
        'sk_test_1234567890abcdef_invalid', // valid format with underscores
      ];

      validKeys.forEach(key => {
        expect(() => createStripeClient(key)).not.toThrow();
      });
    });
  });
});
