const https = require('https');
const chalk = require('chalk');
const { table } = require('table');
const { createStripeClient, getStripeKey } = require('../stripe-client');
const { getStripeApiVersion } = require('../config-loader');

/**
 * Call Stripe GET /v1/terminal/hardware_products via raw HTTPS (SDK may not expose this endpoint).
 * @param {string} secretKey - Stripe secret key
 * @param {Object} params - Query params: limit, status (optional)
 * @param {string} [apiVersion] - Optional Stripe-Version header (e.g. 2026-01-28.clover; terminal_hardware_orders_beta=v5)
 * @returns {Promise<{ data: Array }>}
 */
function requestHardwareProducts(secretKey, params, apiVersion) {
  const search = new URLSearchParams(params).toString();
  const path = `/v1/terminal/hardware_products${search ? `?${search}` : ''}`;
  const auth = Buffer.from(`${secretKey}:`, 'utf8').toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path,
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(apiVersion && { 'Stripe-Version': apiVersion })
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.error) {
              const err = new Error(json.error.message || 'Stripe API error');
              err.type = json.error.type;
              err.code = json.error.code;
              return reject(err);
            }
            resolve(json);
          } catch (e) {
            reject(new Error(body || 'Invalid response from Stripe'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

const tableConfig = {
  border: {
    topBody: '─',
    topJoin: '┬',
    topLeft: '┌',
    topRight: '┐',
    bottomBody: '─',
    bottomJoin: '┴',
    bottomLeft: '└',
    bottomRight: '┘',
    bodyLeft: '│',
    bodyRight: '│',
    bodyJoin: '│',
    joinBody: '─',
    joinLeft: '├',
    joinRight: '┤',
    joinJoin: '┼'
  },
  columnDefault: {
    paddingLeft: 1,
    paddingRight: 1
  }
};

/**
 * Lists Terminal readers (hardware devices)
 * @param {Object} options - Command options
 */
async function listHardware(options) {
  const secretKey = getStripeKey(options);
  const stripe = createStripeClient(secretKey, options);

  try {
    console.log(chalk.blue('Fetching Terminal readers...'));

    const limit = options.limit != null ? parseInt(options.limit, 10) : 50;
    const params = { limit: Math.min(Math.max(limit, 1), 100) };
    if (options.status) params.status = options.status;
    if (options.location) params.location = options.location;
    if (options.deviceType) params.device_type = options.deviceType;

    const readers = await stripe.terminal.readers.list(params);

    if (readers.data.length === 0) {
      console.log(chalk.yellow('No Terminal readers found.'));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(readers.data, null, 2));
      return;
    }

    const tableData = [
      [
        chalk.bold('ID'),
        chalk.bold('Label'),
        chalk.bold('Device type'),
        chalk.bold('Status'),
        chalk.bold('Serial number'),
        chalk.bold('Location'),
        chalk.bold('Created')
      ]
    ];

    readers.data.forEach((reader) => {
      const createdDate = reader.created
        ? new Date(reader.created * 1000).toLocaleDateString()
        : 'N/A';
      tableData.push([
        reader.id,
        reader.label || '—',
        reader.device_type || 'N/A',
        reader.status || 'N/A',
        reader.serial_number || '—',
        typeof reader.location === 'string' ? reader.location : (reader.location || '—'),
        createdDate
      ]);
    });

    console.log(table(tableData, tableConfig));
    console.log(chalk.gray(`\nTotal readers: ${readers.data.length}`));
  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    }
    if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has Terminal access.');
    }
    if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    }
    throw new Error(`Failed to list readers: ${error.message}`);
  }
}

/**
 * Lists Terminal hardware products (catalog of available product types)
 * @param {Object} options - Command options
 */
async function listHardwareCatalog(options) {
  const secretKey = getStripeKey(options);

  try {
    console.log(chalk.blue('Fetching Terminal hardware products...'));

    const limit = options.limit != null ? parseInt(options.limit, 10) : 50;
    const params = { limit: Math.min(Math.max(limit, 1), 100) };
    if (options.status) params.status = options.status;

    // Hardware products endpoint may require beta version header; use config or --api-version
    const apiVersion = options.apiVersion || getStripeApiVersion() || null;
    const result = await requestHardwareProducts(secretKey, params, apiVersion);

    if (result.data.length === 0) {
      console.log(chalk.yellow('No hardware products found.'));
      return;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    const tableData = [
      [
        chalk.bold('ID'),
        chalk.bold('Type'),
        chalk.bold('Status'),
        chalk.bold('Unavailable after')
      ]
    ];

    result.data.forEach((product) => {
      const unavailableAfter = product.unavailable_after
        ? new Date(product.unavailable_after * 1000).toLocaleDateString()
        : '—';
      tableData.push([
        product.id,
        product.type || 'N/A',
        product.status || 'N/A',
        unavailableAfter
      ]);
    });

    console.log(table(tableData, tableConfig));
    console.log(chalk.gray(`\nTotal products: ${result.data.length}`));
  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    }
    if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has Terminal access.');
    }
    if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    }
    throw new Error(`Failed to list hardware products: ${error.message}`);
  }
}

module.exports = {
  listHardware,
  listHardwareCatalog
};
