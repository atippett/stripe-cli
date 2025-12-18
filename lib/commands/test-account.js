const chalk = require('chalk');
const { table } = require('table');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createStripeClient, getStripeKey } = require('../stripe-client');

/**
 * Loads KYC test data configuration from YAML file
 * @returns {Object} KYC configuration object
 */
function loadKYCConfig() {
  const configPath = path.join(__dirname, '..', '..', 'kyc.yml');
  
  try {
    if (!fs.existsSync(configPath)) {
      throw new Error(`KYC config file not found: ${configPath}`);
    }
    
    const fileContents = fs.readFileSync(configPath, 'utf8');
    return yaml.load(fileContents);
  } catch (error) {
    throw new Error(`Failed to load KYC config: ${error.message}`);
  }
}

/**
 * Generates test connected accounts for all configured countries with card_payments and transfers capabilities
 * and all KYC/KYB requirements filled in
 * @param {Object} options - Command options
 */
async function generateTestAccounts(options) {
  const secretKey = getStripeKey(options, 'test.account.generate');
  const stripe = createStripeClient(secretKey);

  try {
    // Load KYC configuration
    const kycConfig = loadKYCConfig();
    
    // Get all country configurations (exclude 'common')
    const countryKeys = Object.keys(kycConfig).filter(key => key !== 'common');
    
    if (countryKeys.length === 0) {
      throw new Error('No country configurations found in kyc.yml');
    }
    
    console.log(chalk.blue(`Creating test connected accounts for ${countryKeys.length} countries...\n`));

    const timestamp = Date.now();
    const createdAccounts = [];

    // Create accounts for all configured countries
    for (const countryKey of countryKeys) {
      const countryConfig = kycConfig[countryKey];
      const countryCode = countryConfig.country.toLowerCase();
      const email = `test.${countryCode}.${timestamp}@example.com`;

      console.log(chalk.blue(`Creating ${countryConfig.country} (${countryCode.toUpperCase()}) account...`));

      // Build account data from config
      const commonConfig = { ...kycConfig.common };
      // Remove tos_acceptance for Express accounts (Stripe handles it through onboarding)
      delete commonConfig.tos_acceptance;
      
      const accountData = {
        ...commonConfig,
        country: countryConfig.country,
        email: email,
        business_type: countryConfig.business_type,
        business_profile: {
          ...countryConfig.business_profile,
          support_email: email
        },
        external_account: countryConfig.external_account
      };
      
      // Add individual or company data based on business_type
      if (countryConfig.business_type === 'individual') {
        accountData.individual = {
          ...countryConfig.individual,
          email: email
          // Note: relationship, id_number, nationality, full_name_aliases are included from config if present
        };
      } else if (countryConfig.business_type === 'company') {
        accountData.company = {
          ...countryConfig.company
        };
      }

      try {
        const account = await stripe.accounts.create(accountData);
        
        // For Express accounts, create an Account Link to allow onboarding completion
        // Note: ToS acceptance must be done through Stripe's onboarding interface
        // We cannot programmatically accept ToS for Express accounts
        let accountLinkUrl = null;
        if (kycConfig.common.type === 'express') {
          try {
            const accountLink = await stripe.accountLinks.create({
              account: account.id,
              type: 'account_onboarding',
              refresh_url: 'https://example.com/reauth',
              return_url: 'https://example.com/return'
            });
            accountLinkUrl = accountLink.url;
            console.log(chalk.blue(`  🔗 Account Link: ${accountLink.url}`));
            console.log(chalk.gray(`     (Use this link to complete onboarding and accept ToS)`));
          } catch (linkError) {
            // Account Link creation is optional, continue even if it fails
            console.log(chalk.yellow(`  ⚠️  Could not create Account Link: ${linkError.message}`));
          }
        }
        
        // Retrieve the account to check requirements
        const fullAccount = await stripe.accounts.retrieve(account.id);
        
        // Check if there are any currently_due requirements and try to fulfill them
        const requirements = fullAccount.requirements || {};
        const currentlyDue = requirements.currently_due || [];
        const disabledReason = requirements.disabled_reason;
        
        // Filter out tos_acceptance requirements for Express accounts (handled through onboarding)
        const tosRequirements = currentlyDue.filter(req => req.includes('tos_acceptance'));
        const relevantDue = currentlyDue.filter(req => {
          if (kycConfig.common.type === 'express' && req.includes('tos_acceptance')) {
            return false; // Express accounts handle ToS through onboarding
          }
          return true;
        });
        
        if (relevantDue.length > 0 || disabledReason) {
          const displayDue = relevantDue.length > 0 ? relevantDue : currentlyDue;
          console.log(chalk.yellow(`  ⚠️  Requirements pending: ${displayDue.length > 0 ? displayDue.join(', ') : disabledReason || 'unknown'}`));
          
          // For Express accounts, note that ToS is handled through onboarding
          if (kycConfig.common.type === 'express' && tosRequirements.length > 0) {
            console.log(chalk.gray(`     Note: ToS acceptance for Express accounts must be done through Stripe's onboarding`));
            if (accountLinkUrl) {
              console.log(chalk.gray(`     Complete onboarding using the Account Link URL shown above`));
            } else {
              console.log(chalk.gray(`     Create an Account Link to complete onboarding: stripe.accountLinks.create({ account: '${account.id}', type: 'account_onboarding' })`));
            }
          }
          
          // Try to update account with additional information that might be missing
          const updateData = {};
          let needsUpdate = false;
          
          // Add verification document if needed (using test file tokens)
          if (currentlyDue.some(req => req.includes('verification') || req.includes('document') || req.includes('identity') || req.includes('individual.verification'))) {
            // Update individual with verification document (only include updatable fields)
            const individualUpdate = {
              first_name: fullAccount.individual?.first_name,
              last_name: fullAccount.individual?.last_name,
              email: fullAccount.individual?.email,
              phone: fullAccount.individual?.phone,
              dob: fullAccount.individual?.dob,
              address: fullAccount.individual?.address,
              verification: {
                document: {
                  front: 'file_identity_document_success' // Stripe test file token for successful verification
                }
              }
            };
            // Add id_number if it exists and is needed
            if (currentlyDue.some(req => req.includes('id_number'))) {
              individualUpdate.id_number = '000000000';
            }
            // Add relationship if needed
            if (currentlyDue.some(req => req.includes('relationship'))) {
              individualUpdate.relationship = {
                title: 'Owner'
              };
            }
            // Add state if needed (for IE)
            if (currentlyDue.some(req => req.includes('address.state'))) {
              if (individualUpdate.address) {
                individualUpdate.address.state = individualUpdate.address.country === 'IE' ? 'Dublin' : 'CA';
              }
            }
            // Add nationality if needed (for SG)
            if (currentlyDue.some(req => req.includes('nationality'))) {
              individualUpdate.nationality = countryConfig.country;
            }
            // Add full_name_aliases if needed (for SG)
            if (currentlyDue.some(req => req.includes('full_name_aliases'))) {
              individualUpdate.full_name_aliases = [];
            }
            updateData.individual = individualUpdate;
            needsUpdate = true;
          }
          
          // Handle individual.* requirements that don't involve verification
          if (currentlyDue.some(req => req.startsWith('individual.') && !req.includes('verification'))) {
            if (!updateData.individual) {
              // Only include updatable fields, exclude read-only ones
              updateData.individual = {
                first_name: fullAccount.individual?.first_name,
                last_name: fullAccount.individual?.last_name,
                email: fullAccount.individual?.email,
                phone: fullAccount.individual?.phone,
                dob: fullAccount.individual?.dob,
                address: fullAccount.individual?.address
              };
            }
            
            // Add specific missing fields
            if (currentlyDue.some(req => req.includes('id_number'))) {
              updateData.individual.id_number = '000000000';
            }
            if (currentlyDue.some(req => req.includes('relationship'))) {
              updateData.individual.relationship = { title: 'Owner' };
            }
            if (currentlyDue.some(req => req.includes('address.state'))) {
              if (updateData.individual.address) {
                updateData.individual.address.state = countryConfig.country === 'IE' ? 'Dublin' : 'CA';
              }
            }
            if (currentlyDue.some(req => req.includes('nationality'))) {
              updateData.individual.nationality = countryConfig.country;
            }
            if (currentlyDue.some(req => req.includes('full_name_aliases'))) {
              updateData.individual.full_name_aliases = [];
            }
            needsUpdate = true;
          }
          
          // Handle business_profile.url requirement
          if (currentlyDue.some(req => req.includes('business_profile.url'))) {
            updateData.business_profile = {
              ...fullAccount.business_profile,
              url: 'https://accessible.stripe.com' // Stripe test URL token for successful validation
            };
            needsUpdate = true;
          }
          
          // Ensure business_profile has MCC code (required for some countries)
          if (!fullAccount.business_profile?.mcc) {
            if (!updateData.business_profile) {
              updateData.business_profile = { ...fullAccount.business_profile };
            }
            updateData.business_profile.mcc = '5734'; // Computer software stores - generic MCC code
            needsUpdate = true;
          }
          
          // For company accounts, ensure owners are provided
          if (fullAccount.business_type === 'company' && currentlyDue.some(req => req.includes('owners') || req.includes('company'))) {
            if (!updateData.company) {
              updateData.company = { ...fullAccount.company };
            }
            updateData.company.owners_provided = true;
            needsUpdate = true;
          }
          
          // If we have updates, apply them
          if (needsUpdate) {
            try {
              await stripe.accounts.update(account.id, updateData);
              console.log(chalk.blue(`  ↻ Updated account with verification documents and MCC code`));
              
              // Wait a moment for Stripe to process the verification
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Retrieve updated account to check if requirements are now met
              const updatedAccount = await stripe.accounts.retrieve(account.id);
              const updatedRequirements = updatedAccount.requirements || {};
              const stillDue = updatedRequirements.currently_due || [];
              
              // Update the account object in our results
              Object.assign(fullAccount, {
                charges_enabled: updatedAccount.charges_enabled,
                payouts_enabled: updatedAccount.payouts_enabled,
                capabilities: updatedAccount.capabilities,
                requirements: updatedAccount.requirements
              });
              
              if (stillDue.length === 0 && updatedAccount.charges_enabled) {
                console.log(chalk.green(`  ✓ Charges enabled after update`));
              } else if (stillDue.length > 0) {
                console.log(chalk.yellow(`  ⚠️  Still pending: ${stillDue.join(', ')}`));
              } else if (!updatedAccount.charges_enabled) {
                console.log(chalk.yellow(`  ⚠️  Charges not yet enabled (may require manual review in test mode)`));
              }
            } catch (updateError) {
              console.log(chalk.yellow(`  ⚠️  Could not update account: ${updateError.message}`));
            }
          }
        } else if (fullAccount.charges_enabled) {
          console.log(chalk.green(`  ✓ Charges already enabled`));
        } else {
          // Even if no requirements are due, charges might not be enabled yet
          // This can happen in test mode where some verification is automatic but takes time
          console.log(chalk.yellow(`  ⚠️  Charges not enabled (verification may be processing)`));
        }
        
        createdAccounts.push({
          country: countryConfig.country,
          countryCode: countryCode.toUpperCase(),
          account: fullAccount,
          email: email
        });
        console.log(chalk.green(`✅ ${countryConfig.country} account created: ${account.id}`));
      } catch (error) {
        console.error(chalk.red(`❌ Failed to create ${countryConfig.country} account: ${error.message}`));
        // Continue with other countries even if one fails
      }
    }

    if (createdAccounts.length === 0) {
      throw new Error('No accounts were successfully created');
    }

    // Display results
    if (options.format === 'json') {
      const result = {};
      createdAccounts.forEach(({ countryCode, account }) => {
        result[countryCode.toLowerCase()] = account;
      });
      console.log('\n' + JSON.stringify(result, null, 2));
      return;
    }

    // Format as table
    const tableData = [
      [
        chalk.bold('Country'),
        chalk.bold('Account ID'),
        chalk.bold('Email'),
        chalk.bold('Business Name'),
        chalk.bold('Capabilities'),
        chalk.bold('Charges Enabled'),
        chalk.bold('Payouts Enabled')
      ]
    ];

    // Add all created accounts to table
    createdAccounts.forEach(({ country, countryCode, account, email }) => {
      const capabilities = account.capabilities?.card_payments || 'pending';
      tableData.push([
        countryCode,
        account.id,
        email,
        account.business_profile?.name || 'N/A',
        capabilities,
        account.charges_enabled ? chalk.green('✓') : chalk.red('✗'),
        account.payouts_enabled ? chalk.green('✓') : chalk.red('✗')
      ]);
    });

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

    console.log('\n' + table(tableData, tableConfig));
    console.log(chalk.gray('\nNote: Capabilities may take a few moments to activate after KYC/KYB verification.'));
    console.log(chalk.gray('Check account status in Stripe Dashboard or use account.list command.'));

  } catch (error) {
    if (error.type === 'StripeAuthenticationError') {
      throw new Error('Invalid Stripe API key. Please check your API key.');
    } else if (error.type === 'StripePermissionError') {
      throw new Error('Insufficient permissions. Make sure your API key has the required permissions.');
    } else if (error.type === 'StripeAPIError') {
      throw new Error(`Stripe API error: ${error.message}`);
    } else {
      throw new Error(`Failed to generate test accounts: ${error.message}`);
    }
  }
}

module.exports = {
  generateTestAccounts
};
