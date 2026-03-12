const chalk = require('chalk');
const { createStripeClient, getStripeKey } = require('../stripe-client');

/**
 * Creates a Checkout Session in setup mode for a connected account (e.g. collect bank account).
 * Uses the platform secret key with customer_account (Accounts v2) so the account is the customer
 * and the payment method attaches directly to the account.
 *
 * @param {string} connectedAccount - Connected account ID (acct_...) used as customer_account
 * @param {Object} options - Command options: success_url, cancel_url, currency, payment_method_types, format, key, platform
 * @returns {Promise<void>}
 */
async function createSetupSession(connectedAccount, options) {
  const secretKey = getStripeKey(options, 'checkout.session.setup');
  const stripe = createStripeClient(secretKey, options);

  const successUrl = options.successUrl || options.success_url || 'https://www.example.com';
  const cancelUrl = options.cancelUrl || options.cancel_url || 'https://www.example.com';
  const currency = (options.currency || 'usd').toLowerCase();
  const paymentMethodTypes = options.paymentMethodTypes || options.payment_method_types || 'us_bank_account';
  const types = Array.isArray(paymentMethodTypes)
    ? paymentMethodTypes
    : String(paymentMethodTypes).split(',').map((t) => t.trim()).filter(Boolean);
  if (types.length === 0) types.push('us_bank_account');

  try {
    const sessionParams = {
      mode: 'setup',
      success_url: successUrl,
      cancel_url: cancelUrl,
      currency,
      payment_method_types: types
    };

    const useCustomerAccount = !options.customer && !options.customerEmail;
    if (useCustomerAccount) {
      sessionParams.customer_account = connectedAccount;
    } else {
      if (options.customer) sessionParams.customer = options.customer;
      if (options.customerEmail) sessionParams.customer_email = options.customerEmail;
    }

    const session = useCustomerAccount
      ? await stripe.checkout.sessions.create(sessionParams)
      : await stripe.checkout.sessions.create(sessionParams, { stripeAccount: connectedAccount });

    if (options.format === 'json') {
      console.log(JSON.stringify(session, null, 2));
      return;
    }

    if (session.url) {
      console.log(chalk.green('Checkout Session created (setup mode). Direct the customer to this URL to set up their bank account:'));
      console.log(chalk.cyan(session.url));
    }
    console.log(chalk.gray(`Session ID: ${session.id}`));
  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    }
    if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your platform key can create Checkout Sessions for the connected account.');
    }
    if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    }
    throw new Error(`Failed to create Checkout Session: ${error.message}`);
  }
}

module.exports = {
  createSetupSession
};
