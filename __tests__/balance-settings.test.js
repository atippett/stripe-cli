const nock = require('nock');

// Mock key resolution so the command logic runs without real credentials
jest.mock('../lib/stripe-client', () => ({
  getStripeKey: jest.fn(() => 'rk_test_mock_key')
}));

// Mock readline so interactive prompts can be scripted via `answerQueue`
const answerQueue = [];
jest.mock('readline', () => ({
  createInterface: () => ({
    question: (_q, cb) => cb(answerQueue.length ? answerQueue.shift() : ''),
    close: () => {}
  })
}));

const {
  setPayoutSettings,
  getPayoutSettings,
  buildPayoutParams,
  flattenForStripe
} = require('../lib/commands/balance-settings');

describe('Payout settings (Balance Settings)', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    nock.cleanAll();
  });

  describe('flattenForStripe', () => {
    test('flattens nested objects into bracket notation', () => {
      const flat = flattenForStripe({
        payments: {
          settlement_timing: { start_of_day: { hour: 9, minutes: 30, timezone: 'US/Eastern' } }
        }
      });
      expect(flat).toEqual({
        'payments[settlement_timing][start_of_day][hour]': 9,
        'payments[settlement_timing][start_of_day][minutes]': 30,
        'payments[settlement_timing][start_of_day][timezone]': 'US/Eastern'
      });
    });

    test('indexes arrays and maps null to empty string', () => {
      const flat = flattenForStripe({
        payments: {
          payouts: { schedule: { monthly_payout_days: [5, 20] } },
          settlement_timing: { delay_days_override: null }
        }
      });
      expect(flat).toEqual({
        'payments[payouts][schedule][monthly_payout_days][0]': 5,
        'payments[payouts][schedule][monthly_payout_days][1]': 20,
        'payments[settlement_timing][delay_days_override]': ''
      });
    });
  });

  describe('buildPayoutParams validation', () => {
    test('rejects invalid interval', () => {
      expect(() => buildPayoutParams({ interval: 'hourly' })).toThrow(/--interval must be one of/);
    });
    test('rejects invalid weekly day', () => {
      expect(() => buildPayoutParams({ weeklyPayoutDays: 'sunday' })).toThrow(/--weekly-payout-days/);
    });
    test('rejects out-of-range monthly day', () => {
      expect(() => buildPayoutParams({ monthlyPayoutDays: '0,40' })).toThrow(/--monthly-payout-days/);
    });
    test('rejects out-of-range hour', () => {
      expect(() => buildPayoutParams({ hour: 99 })).toThrow(/--hour must be an integer/);
    });
    test('rejects invalid minutes', () => {
      expect(() => buildPayoutParams({ minutes: 15 })).toThrow(/--minutes must be 0 or 30/);
    });
    test('rejects empty timezone', () => {
      expect(() => buildPayoutParams({ timezone: '  ' })).toThrow(/--timezone cannot be empty/);
    });
    test('rejects malformed minimum-balance', () => {
      expect(() => buildPayoutParams({ minimumBalance: ['usd'] })).toThrow(/--minimum-balance/);
    });
    test('rejects bad delay-days', () => {
      expect(() => buildPayoutParams({ delayDays: '99' })).toThrow(/--delay-days/);
    });
    test('"reset" delay-days maps to null (empty string when flattened)', () => {
      const params = buildPayoutParams({ delayDays: 'reset' });
      expect(flattenForStripe(params)).toEqual({ 'payments[settlement_timing][delay_days_override]': '' });
    });
    test('builds a full payouts + settlement_timing patch', () => {
      const params = buildPayoutParams({
        interval: 'monthly',
        monthlyPayoutDays: '5,20',
        statementDescriptor: 'PAYOUT',
        delayDays: '2',
        hour: 0,
        minutes: 30,
        timezone: 'US/Eastern',
        minimumBalance: ['usd=1000'],
        debitNegativeBalances: 'true'
      });
      expect(flattenForStripe(params)).toEqual({
        'payments[payouts][schedule][interval]': 'monthly',
        'payments[payouts][schedule][monthly_payout_days][0]': 5,
        'payments[payouts][schedule][monthly_payout_days][1]': 20,
        'payments[payouts][statement_descriptor]': 'PAYOUT',
        'payments[payouts][minimum_balance_by_currency][usd]': 1000,
        'payments[settlement_timing][delay_days_override]': 2,
        'payments[settlement_timing][start_of_day][hour]': 0,
        'payments[settlement_timing][start_of_day][minutes]': 30,
        'payments[settlement_timing][start_of_day][timezone]': 'US/Eastern',
        'payments[debit_negative_balances]': true
      });
    });
  });

  describe('setPayoutSettings', () => {
    test('requires an account', async () => {
      await expect(setPayoutSettings({ hour: 9 })).rejects.toThrow(/Connected account ID is required/);
    });

    test('errors when no flags provided and not a TTY', async () => {
      const original = process.stdin.isTTY;
      process.stdin.isTTY = false;
      try {
        await expect(setPayoutSettings({ account: 'acct_x' })).rejects.toThrow(/No settings provided/);
      } finally {
        process.stdin.isTTY = original;
      }
    });

    test('POSTs the flattened patch to /v1/balance_settings', async () => {
      let capturedBody;
      const scope = nock('https://api.stripe.com')
        .post('/v1/balance_settings', (body) => { capturedBody = body; return true; })
        .matchHeader('stripe-account', 'acct_x')
        .reply(200, {
          object: 'balance_settings',
          payouts: { schedule: { interval: 'daily' } },
          settlement_timing: { start_of_day: { hour: 9, minutes: 30, timezone: 'America/New_York' } }
        });

      await setPayoutSettings({
        account: 'acct_x',
        interval: 'daily',
        hour: 9,
        minutes: 30,
        timezone: 'America/New_York',
        format: 'json'
      });

      expect(scope.isDone()).toBe(true);
      expect(capturedBody).toEqual({
        'payments[payouts][schedule][interval]': 'daily',
        'payments[settlement_timing][start_of_day][hour]': '9',
        'payments[settlement_timing][start_of_day][minutes]': '30',
        'payments[settlement_timing][start_of_day][timezone]': 'America/New_York'
      });
    });

    test('backfills hour + minutes from current when only timezone is provided', async () => {
      const getScope = nock('https://api.stripe.com')
        .get('/v1/balance_settings')
        .reply(200, {
          object: 'balance_settings',
          settlement_timing: { start_of_day: { hour: 6, minutes: 30, timezone: 'US/Central' } }
        });
      let capturedBody;
      const postScope = nock('https://api.stripe.com')
        .post('/v1/balance_settings', (body) => { capturedBody = body; return true; })
        .reply(200, {
          object: 'balance_settings',
          settlement_timing: { start_of_day: { hour: 6, minutes: 30, timezone: 'US/Eastern' } }
        });

      await setPayoutSettings({ account: 'acct_x', timezone: 'US/Eastern', format: 'json' });

      expect(getScope.isDone()).toBe(true);
      expect(postScope.isDone()).toBe(true);
      expect(capturedBody).toEqual({
        'payments[settlement_timing][start_of_day][hour]': '6',
        'payments[settlement_timing][start_of_day][minutes]': '30',
        'payments[settlement_timing][start_of_day][timezone]': 'US/Eastern'
      });
    });

    test('does not fetch current when hour, minutes, and timezone are all provided', async () => {
      const getScope = nock('https://api.stripe.com').get('/v1/balance_settings').reply(200, {});
      nock('https://api.stripe.com').post('/v1/balance_settings').reply(200, { object: 'balance_settings' });

      await setPayoutSettings({ account: 'acct_x', hour: 0, minutes: 0, timezone: 'Etc/UTC', format: 'json' });

      expect(getScope.isDone()).toBe(false); // no backfill GET needed
    });
  });

  describe('setPayoutSettings interactive (no flags)', () => {
    test('prompts, confirms, and POSTs the collected changes', async () => {
      const originalTTY = process.stdin.isTTY;
      process.stdin.isTTY = true;
      answerQueue.length = 0;
      // interval, weekly days, statement, delay, hour, minutes, timezone, confirm
      answerQueue.push('weekly', 'monday,friday', '', '', '', '', '', 'y');

      let capturedBody;
      nock('https://api.stripe.com')
        .get('/v1/balance_settings')
        .reply(200, { object: 'balance_settings', payouts: { schedule: { interval: 'daily' } }, settlement_timing: {} });
      const post = nock('https://api.stripe.com')
        .post('/v1/balance_settings', (body) => { capturedBody = body; return true; })
        .reply(200, { object: 'balance_settings', payouts: { schedule: { interval: 'weekly' } }, settlement_timing: {} });

      try {
        await setPayoutSettings({ account: 'acct_x', format: 'json' });
      } finally {
        process.stdin.isTTY = originalTTY;
      }

      expect(post.isDone()).toBe(true);
      expect(capturedBody).toEqual({
        'payments[payouts][schedule][interval]': 'weekly',
        'payments[payouts][schedule][weekly_payout_days][0]': 'monday',
        'payments[payouts][schedule][weekly_payout_days][1]': 'friday'
      });
    });

    test('aborts without POSTing when the user declines confirmation', async () => {
      const originalTTY = process.stdin.isTTY;
      process.stdin.isTTY = true;
      answerQueue.length = 0;
      answerQueue.push('manual', '', '', '', '', '', 'n');

      nock('https://api.stripe.com')
        .get('/v1/balance_settings')
        .reply(200, { object: 'balance_settings', payouts: { schedule: { interval: 'daily' } }, settlement_timing: {} });
      const post = nock('https://api.stripe.com')
        .post('/v1/balance_settings')
        .reply(200, {});

      try {
        await setPayoutSettings({ account: 'acct_x', format: 'json' });
      } finally {
        process.stdin.isTTY = originalTTY;
      }

      expect(post.isDone()).toBe(false);
    });
  });

  describe('getPayoutSettings', () => {
    test('requires an account', async () => {
      await expect(getPayoutSettings({})).rejects.toThrow(/Connected account ID is required/);
    });

    test('renders payouts + settlement_timing from top-level fields', async () => {
      nock('https://api.stripe.com')
        .get('/v1/balance_settings')
        .matchHeader('stripe-account', 'acct_x')
        .reply(200, {
          object: 'balance_settings',
          payouts: { schedule: { interval: 'daily' }, status: 'enabled' },
          settlement_timing: { delay_days: 2, start_of_day: { hour: 0, minutes: 0, timezone: 'US/Eastern' } }
        });

      await getPayoutSettings({ account: 'acct_x', format: 'table' });

      const out = logSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(out).toContain('payouts:');
      expect(out).toContain('interval: daily');
      expect(out).toContain('settlement_timing:');
      expect(out).toContain('start_of_day:');
      expect(out).toContain('timezone: US/Eastern');
    });
  });
});
