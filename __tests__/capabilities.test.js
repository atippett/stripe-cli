const mockListCapabilities = jest.fn();
const mockUpdateCapability = jest.fn();
const mockQuestion = jest.fn();

jest.mock('../lib/stripe-client', () => ({
  getStripeKey: jest.fn(() => 'rk_test_mock_key'),
  createStripeClient: jest.fn(() => ({
    accounts: {
      listCapabilities: mockListCapabilities,
      updateCapability: mockUpdateCapability
    }
  }))
}));

jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({
    question: (message, callback) => mockQuestion(message, callback),
    close: jest.fn()
  }))
}));

const {
  listCapabilities,
  requestCapability,
  removeCapability
} = require('../lib/commands/capabilities');

const CARD_PAYMENTS = {
  id: 'card_payments',
  object: 'capability',
  status: 'active',
  requested: true,
  requested_at: 1741975325,
  requirements: { currently_due: [], eventually_due: [], past_due: [] }
};

const UNREQUESTED = {
  id: 'acss_debit_payments',
  object: 'capability',
  status: 'unrequested',
  requested: false,
  requirements: {
    currently_due: ['company.address.city', 'company.phone'],
    eventually_due: ['company.address.city', 'company.phone'],
    past_due: ['company.address.city', 'company.phone']
  }
};

const AFTERPAY = {
  id: 'afterpay_clearpay',
  object: 'capability',
  status: 'pending',
  requested: true,
  requested_at: 1761746591,
  requirements: {
    currently_due: ['business_profile.url'],
    eventually_due: [],
    past_due: []
  }
};

describe('account.capabilities.*', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    mockListCapabilities.mockReset();
    mockUpdateCapability.mockReset();
    mockQuestion.mockReset();
    mockQuestion.mockImplementation((message, callback) => callback('y'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const stdout = () => logSpy.mock.calls.map(c => String(c[0])).join('\n');

  describe('list', () => {
    test('requires an account', async () => {
      await expect(listCapabilities({})).rejects.toThrow(/account ID is required/i);
      expect(mockListCapabilities).not.toHaveBeenCalled();
    });

    test('json output prints the raw capability array', async () => {
      mockListCapabilities.mockResolvedValue({ data: [CARD_PAYMENTS, AFTERPAY] });

      await listCapabilities({ account: 'acct_x', format: 'json' });

      const parsed = JSON.parse(stdout());
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('card_payments');
    });

    test('table output prints a key: value tree and a total', async () => {
      mockListCapabilities.mockResolvedValue({ data: [CARD_PAYMENTS, AFTERPAY] });

      await listCapabilities({ account: 'acct_x', format: 'table' });

      const out = stdout();
      expect(out).toContain('card_payments');
      expect(out).toContain('status: active');
      expect(out).toContain('requested: true');
      expect(out).toContain('total: 2');
    });

    test('table output omits requirements when nothing is due', async () => {
      mockListCapabilities.mockResolvedValue({ data: [CARD_PAYMENTS] });

      await listCapabilities({ account: 'acct_x', format: 'table' });

      expect(stdout()).not.toContain('currently_due');
    });

    test('table output omits the KYC dump for unrequested capabilities', async () => {
      mockListCapabilities.mockResolvedValue({ data: [UNREQUESTED] });

      await listCapabilities({ account: 'acct_x', format: 'table' });

      const out = stdout();
      expect(out).toContain('acss_debit_payments');
      expect(out).toContain('status: unrequested');
      expect(out).not.toContain('company.phone');
    });

    test('table output keeps requirements for requested capabilities', async () => {
      mockListCapabilities.mockResolvedValue({ data: [AFTERPAY] });

      await listCapabilities({ account: 'acct_x', format: 'table' });

      expect(stdout()).toContain('currently_due: ["business_profile.url"]');
    });

    test('json output keeps requirements for unrequested capabilities', async () => {
      mockListCapabilities.mockResolvedValue({ data: [UNREQUESTED] });

      await listCapabilities({ account: 'acct_x', format: 'json' });

      expect(JSON.parse(stdout())[0].requirements.currently_due).toContain('company.phone');
    });

    test('status chatter goes to stderr, not stdout', async () => {
      mockListCapabilities.mockResolvedValue({ data: [CARD_PAYMENTS] });

      await listCapabilities({ account: 'acct_x', format: 'table' });

      expect(errorSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain('acct_x');
      expect(stdout()).not.toContain('Fetching');
    });

    test('handles an account with no capabilities', async () => {
      mockListCapabilities.mockResolvedValue({ data: [] });

      await listCapabilities({ account: 'acct_x', format: 'table' });

      expect(stdout()).toContain('capabilities:');
      expect(stdout()).not.toContain('total:');
    });
  });

  describe('request', () => {
    test('requires a capability', async () => {
      await expect(requestCapability({ account: 'acct_x' })).rejects.toThrow(/capability ID is required/i);
      expect(mockUpdateCapability).not.toHaveBeenCalled();
    });

    test('sets requested: true', async () => {
      mockUpdateCapability.mockResolvedValue(AFTERPAY);

      await requestCapability({ account: 'acct_x', capability: 'afterpay_clearpay', format: 'table' });

      expect(mockUpdateCapability).toHaveBeenCalledWith('acct_x', 'afterpay_clearpay', { requested: true });
      const out = stdout();
      expect(out).toContain('id: afterpay_clearpay');
      expect(out).toContain('status: pending');
      expect(out).toContain('currently_due: ["business_profile.url"]');
    });

    test('maps Stripe permission errors to a friendly message', async () => {
      const err = new Error('nope');
      err.type = 'StripePermissionError';
      mockUpdateCapability.mockRejectedValue(err);

      await expect(
        requestCapability({ account: 'acct_x', capability: 'afterpay_clearpay' })
      ).rejects.toThrow(/Insufficient permissions/);
    });
  });

  describe('remove', () => {
    const REMOVED = { ...AFTERPAY, status: 'inactive', requested: false, requested_at: null };

    test('sets requested: false after confirmation', async () => {
      mockUpdateCapability.mockResolvedValue(REMOVED);

      await removeCapability({ account: 'acct_x', capability: 'afterpay_clearpay', format: 'table' });

      expect(mockQuestion).toHaveBeenCalled();
      expect(mockUpdateCapability).toHaveBeenCalledWith('acct_x', 'afterpay_clearpay', { requested: false });
      expect(stdout()).toContain('requested: false');
    });

    test('aborts without calling Stripe when the prompt is declined', async () => {
      mockQuestion.mockImplementation((message, callback) => callback('n'));

      await removeCapability({ account: 'acct_x', capability: 'afterpay_clearpay' });

      expect(mockUpdateCapability).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain('Aborted');
    });

    test('-y skips the prompt', async () => {
      mockUpdateCapability.mockResolvedValue(REMOVED);

      await removeCapability({ account: 'acct_x', capability: 'afterpay_clearpay', yes: true, format: 'json' });

      expect(mockQuestion).not.toHaveBeenCalled();
      expect(JSON.parse(stdout()).requested).toBe(false);
    });

    test('requires a capability', async () => {
      await expect(removeCapability({ account: 'acct_x' })).rejects.toThrow(/capability ID is required/i);
      expect(mockQuestion).not.toHaveBeenCalled();
    });
  });
});
