#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const { listAccounts } = require('../lib/commands/account');
const { 
  enableNetworkCostPassthrough, 
  disableNetworkCostPassthrough, 
  getNetworkCostPassthroughStatus,
  deleteNetworkCostPassthroughScheme 
} = require('../lib/commands/account-settings');
const ProfileManager = require('../lib/profile-manager');

const program = new Command();

program
  .name('stripe-cli')
  .description('A CLI tool for making Stripe API calls')
  .version('1.0.0');

// Account commands
const accountCommand = program
  .command('account')
  .description('Manage Stripe Connect accounts');

accountCommand
  .command('list')
  .description('List the first 50 Connect accounts')
  .option('-k, --key <key>', 'Stripe secret key (or set STRIPE_SECRET_KEY env var)')
  .option('-p, --profile <profile>', 'Use profile from .profile config file')
  .option('-f, --format <format>', 'Output format (table, json)', 'table')
  .action(async (options) => {
    try {
      await listAccounts(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Account settings commands
const settingsCommand = accountCommand
  .command('settings')
  .description('Manage account settings');

// Network cost passthrough commands
const networkCostsCommand = settingsCommand
  .command('network-costs')
  .description('Manage network cost passthrough settings');

networkCostsCommand
  .command('enable')
  .description('Enable network cost passthrough for a connected account')
  .option('-a, --account <account>', 'Connected account ID (required)')
  .option('-k, --key <key>', 'Stripe secret key (or set STRIPE_SECRET_KEY env var)')
  .option('-p, --profile <profile>', 'Use profile from .profile config file')
  .option('-f, --format <format>', 'Output format (table, json)', 'table')
  .option('--starts-at <timestamp>', 'Unix timestamp for future activation (optional)')
  .action(async (options) => {
    try {
      await enableNetworkCostPassthrough(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

networkCostsCommand
  .command('disable')
  .description('Disable network cost passthrough for a connected account')
  .option('-a, --account <account>', 'Connected account ID (required)')
  .option('-k, --key <key>', 'Stripe secret key (or set STRIPE_SECRET_KEY env var)')
  .option('-p, --profile <profile>', 'Use profile from .profile config file')
  .option('-f, --format <format>', 'Output format (table, json)', 'table')
  .option('--starts-at <timestamp>', 'Unix timestamp for future activation (optional)')
  .action(async (options) => {
    try {
      await disableNetworkCostPassthrough(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

networkCostsCommand
  .command('status')
  .description('Get network cost passthrough status for a connected account')
  .option('-a, --account <account>', 'Connected account ID (required)')
  .option('-k, --key <key>', 'Stripe secret key (or set STRIPE_SECRET_KEY env var)')
  .option('-p, --profile <profile>', 'Use profile from .profile config file')
  .option('-f, --format <format>', 'Output format (table, json)', 'table')
  .action(async (options) => {
    try {
      await getNetworkCostPassthroughStatus(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

networkCostsCommand
  .command('delete-scheme')
  .description('Delete a scheduled network cost passthrough scheme')
  .option('-a, --account <account>', 'Connected account ID (required)')
  .option('-k, --key <key>', 'Stripe secret key (or set STRIPE_SECRET_KEY env var)')
  .option('-p, --profile <profile>', 'Use profile from .profile config file')
  .option('-f, --format <format>', 'Output format (table, json)', 'table')
  .option('--scheme-id <schemeId>', 'Scheme ID to delete (required)')
  .action(async (options) => {
    try {
      await deleteNetworkCostPassthroughScheme(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Profile management commands
const profileCommand = program
  .command('profile')
  .description('Manage Stripe API key profiles');

profileCommand
  .command('list')
  .description('List all configured profiles')
  .action(() => {
    try {
      const profileManager = new ProfileManager();
      profileManager.loadProfiles();
      profileManager.listProfiles();
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program.parse();

