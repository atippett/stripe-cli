const {
  buildMap,
  formatResultsReport,
  resolveColumns,
  normKey,
  normalizeLast4,
  parseCcExpiry,
  ccRowJoinKey,
  stripeRowJoinKey,
  CC_COLUMN_SPECS,
  STRIPE_COLUMN_SPECS
} = require('../lib/commands/migrate-cards');

// A Stripe migration-result row (headers unchanged across formats).
function stripeRow(overrides = {}) {
  return {
    old_id: 'cust_123',
    source_old_id: 'src_123',
    created_customer: 'cus_ABC',
    source_new_id: 'pm_ABC',
    card_fingerprint: 'fp_1',
    card_last4: '4242',
    card_exp_month: '12',
    card_exp_year: '2027',
    card_brand: 'visa',
    ...overrides
  };
}

describe('header normalization', () => {
  test('normKey strips spaces, case, and punctuation', () => {
    expect(normKey('Profile ID')).toBe('profileid');
    expect(normKey('card_exp_month')).toBe('cardexpmonth');
    expect(normKey('Expiry Month')).toBe('expirymonth');
    expect(normKey('  Last 4 ')).toBe('last4');
  });

  test('resolveColumns maps canonical fields to actual headers (new format)', () => {
    const headers = ['Default', 'Brand', 'Last 4', 'Token', 'Expiry Month', 'Expiry Year', 'Profile ID', 'Acct ID'];
    const cols = resolveColumns(headers, CC_COLUMN_SPECS);
    expect(cols.profileId).toBe('Profile ID');
    expect(cols.acctId).toBe('Acct ID');
    expect(cols.last4).toBe('Last 4');
    expect(cols.expiryMonth).toBe('Expiry Month');
    expect(cols.expiryYear).toBe('Expiry Year');
    expect(cols.token).toBe('Token');
    expect(cols.expiry).toBeUndefined();
  });

  test('resolveColumns maps canonical fields to actual headers (legacy format)', () => {
    const cols = resolveColumns(['profileid', 'acctid', 'token', 'expiry'], CC_COLUMN_SPECS);
    expect(cols.profileId).toBe('profileid');
    expect(cols.expiry).toBe('expiry');
    expect(cols.expiryMonth).toBeUndefined();
    expect(cols.last4).toBeUndefined();
  });

  test('resolveColumns maps Stripe headers', () => {
    const cols = resolveColumns(Object.keys(stripeRow()), STRIPE_COLUMN_SPECS);
    expect(cols.oldId).toBe('old_id');
    expect(cols.last4).toBe('card_last4');
    expect(cols.expMonth).toBe('card_exp_month');
    expect(cols.expYear).toBe('card_exp_year');
  });
});

describe('value normalization', () => {
  test('normalizeLast4 zero-pads and trims to 4 digits', () => {
    expect(normalizeLast4('4242')).toBe('4242');
    expect(normalizeLast4('42')).toBe('0042');
    expect(normalizeLast4('xxxx4242')).toBe('4242');
    expect(normalizeLast4('')).toBe('');
    expect(normalizeLast4(null)).toBe('');
  });

  test('parseCcExpiry handles MM/YY, MM/YYYY, and MMYY', () => {
    expect(parseCcExpiry('12/27')).toEqual({ month: 12, year: 2027 });
    expect(parseCcExpiry('1/2030')).toEqual({ month: 1, year: 2030 });
    expect(parseCcExpiry('0627')).toEqual({ month: 6, year: 2027 });
    expect(parseCcExpiry('')).toEqual({ month: null, year: null });
  });
});

describe('join keys', () => {
  test('new and legacy CardConnect rows produce identical join keys', () => {
    const stripeCols = resolveColumns(Object.keys(stripeRow()), STRIPE_COLUMN_SPECS);
    const stripeKey = stripeRowJoinKey(stripeRow(), stripeCols);

    const newRow = { 'Profile ID': 'cust_123', 'Token': '9999990000004242', 'Last 4': '4242', 'Expiry Month': '12', 'Expiry Year': '2027' };
    const newCols = resolveColumns(Object.keys(newRow), CC_COLUMN_SPECS);
    expect(ccRowJoinKey(newRow, newCols)).toBe(stripeKey);

    const legacyRow = { profileid: 'cust_123', token: '9999990000004242', expiry: '12/27' };
    const legacyCols = resolveColumns(Object.keys(legacyRow), CC_COLUMN_SPECS);
    expect(ccRowJoinKey(legacyRow, legacyCols)).toBe(stripeKey);
  });

  test('blank profileid yields no key', () => {
    const cols = resolveColumns(['Profile ID', 'Last 4', 'Expiry Month', 'Expiry Year'], CC_COLUMN_SPECS);
    expect(ccRowJoinKey({ 'Profile ID': '', 'Last 4': '4242', 'Expiry Month': '12', 'Expiry Year': '2027' }, cols)).toBeNull();
  });
});

describe('buildMap (new CardConnect format)', () => {
  const ccRows = [
    { 'Last 4': '4242', 'Token': '9999990000004242', 'Expiry Month': '12', 'Expiry Year': '2027', 'Profile ID': 'cust_123', 'Acct ID': '100' },
    { 'Last 4': '1111', 'Token': '9999990000001111', 'Expiry Month': '01', 'Expiry Year': '2026', 'Profile ID': 'cust_999', 'Acct ID': '101' }
  ];
  const stripeRows = [
    stripeRow(),
    stripeRow({ old_id: 'cust_777', card_last4: '5555', card_exp_month: '03', card_exp_year: '2028' })
  ];

  test('classifies matched, cardconnect_only, and stripe_only', () => {
    const { summary, results } = buildMap(ccRows, stripeRows, 'acct_TEST');
    expect(summary.matched).toBe(1);
    expect(summary.cardconnect_only).toBe(1);
    expect(summary.stripe_only).toBe(1);
    expect(summary.total).toBe(3);

    const matchedRow = results.find(r => r.match_status === 'matched');
    expect(matchedRow.stripe_connected_account).toBe('acct_TEST');
    expect(matchedRow['Profile ID']).toBe('cust_123');
    expect(matchedRow.stripe_created_customer).toBe('cus_ABC');
    expect(matchedRow.stripe_source_new_id).toBe('pm_ABC');
  });

  test('derives last4 from token when Last 4 column is absent', () => {
    const noLast4 = ccRows.map(({ ['Last 4']: _omit, ...rest }) => rest);
    const { summary } = buildMap(noLast4, stripeRows, '');
    expect(summary.matched).toBe(1);
  });
});

describe('buildMap (legacy CardConnect format)', () => {
  test('still matches via single expiry column and token-derived last4', () => {
    const ccRows = [{ profileid: 'cust_123', acctid: '100', token: '9999990000004242', expiry: '12/27' }];
    const { summary } = buildMap(ccRows, [stripeRow()], '');
    expect(summary.matched).toBe(1);
  });
});

describe('buildMap validation', () => {
  test('throws when CardConnect is missing profileid', () => {
    const ccRows = [{ 'Last 4': '4242', 'Expiry Month': '12', 'Expiry Year': '2027' }];
    expect(() => buildMap(ccRows, [stripeRow()], '')).toThrow(/missing required column.*profileid/i);
  });

  test('throws when CardConnect has no expiry information', () => {
    const ccRows = [{ 'Profile ID': 'cust_123', 'Last 4': '4242' }];
    expect(() => buildMap(ccRows, [stripeRow()], '')).toThrow(/expiry/i);
  });

  test('throws when Stripe file is missing required columns', () => {
    const ccRows = [{ 'Profile ID': 'cust_123', 'Last 4': '4242', 'Expiry Month': '12', 'Expiry Year': '2027' }];
    const badStripe = [{ old_id: 'cust_123', card_last4: '4242', card_exp_month: '12', card_exp_year: '2027' }];
    expect(() => buildMap(ccRows, badStripe, '')).toThrow(/missing required column.*created_customer/i);
  });

  test('throws on non-numeric acctid', () => {
    const ccRows = [{ 'Profile ID': 'cust_123', 'Acct ID': 'NOPE', 'Last 4': '4242', 'Expiry Month': '12', 'Expiry Year': '2027' }];
    expect(() => buildMap(ccRows, [stripeRow()], '')).toThrow(/non-numeric acctid/i);
  });

  test('warns (does not throw) when Stripe lacks join columns', () => {
    const ccRows = [{ 'Profile ID': 'cust_123', 'Last 4': '4242', 'Expiry Month': '12', 'Expiry Year': '2027' }];
    const stripeNoJoin = [{ old_id: 'cust_123', created_customer: 'cus_ABC', source_new_id: 'pm_ABC' }];
    const { warnings, summary } = buildMap(ccRows, stripeNoJoin, '');
    expect(warnings.length).toBeGreaterThan(0);
    expect(summary.matched).toBe(0);
  });
});

describe('formatResultsReport', () => {
  const ccRows = [
    { 'Last 4': '4242', 'Token': '9999990000004242', 'Expiry Month': '12', 'Expiry Year': '2027', 'Profile ID': 'cust_123', 'Acct ID': '100' },
    { 'Last 4': '1111', 'Token': '9999990000001111', 'Expiry Month': '01', 'Expiry Year': '2026', 'Profile ID': 'cust_999', 'Acct ID': '101' }
  ];
  const stripeRows = [
    stripeRow(),
    stripeRow({ old_id: 'cust_777', created_customer: 'cus_XYZ', source_new_id: 'pm_XYZ', card_last4: '5555', card_exp_month: '03', card_exp_year: '2028' })
  ];

  test('reports summary, reconciliation, and the specific unmatched accounts', () => {
    const build = buildMap(ccRows, stripeRows, 'acct_TEST');
    const report = formatResultsReport(build, { connectedAccount: 'acct_TEST', ccFile: 'cc.csv', stripeFile: 'stripe.csv' });

    expect(report).toContain('Connected account: acct_TEST');
    expect(report).toContain('Matched:          1');
    expect(report).toContain('CardConnect 2 = 1 matched + 1 cardconnect_only');

    // CardConnect-only entry (cust_999) is listed; matched one (cust_123) is not.
    expect(report).toContain('CardConnect-only (no Stripe match) — 1');
    expect(report).toContain('profileid=cust_999');
    expect(report).not.toContain('profileid=cust_123');

    // Stripe-only entry (cust_777) is listed with its Stripe identifiers.
    expect(report).toContain('Stripe-only (no CardConnect match) — 1');
    expect(report).toContain('old_id=cust_777');
    expect(report).toContain('customer=cus_XYZ');
    expect(report).toContain('payment_method=pm_XYZ');
  });

  test('shows "(none)" sections when everything matches', () => {
    const build = buildMap([ccRows[0]], [stripeRow()], '');
    const report = formatResultsReport(build, {});
    expect(report).toContain('CardConnect-only (no Stripe match) — 0');
    expect(report).toContain('Stripe-only (no CardConnect match) — 0');
    expect(report).toContain('(none)');
  });
});
