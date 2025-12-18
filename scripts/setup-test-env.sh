#!/bin/bash

# Setup script for Stripe CLI test environment
# This script helps configure the test environment for integration tests

set -e

echo "🔧 Setting up Stripe CLI test environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check for Stripe test key
if [ -z "$STRIPE_TEST_KEY" ]; then
    echo "⚠️  STRIPE_TEST_KEY environment variable is not set."
    echo "   To run integration tests, you need a Stripe test key."
    echo "   Get one from: https://dashboard.stripe.com/test/apikeys"
    echo ""
    echo "   Options:"
    echo "   1. Set environment variable: export STRIPE_TEST_KEY=sk_test_your_key_here"
    echo "   2. Add to .env file: STRIPE_TEST_KEY=sk_test_your_key_here"
    echo "   3. Add test_profile=profile_name to [global] section in .profile file"
    echo ""
    echo "   For now, only unit tests will run."
else
    echo "✅ STRIPE_TEST_KEY is set"
    
    # Validate the key format
    if [[ $STRIPE_TEST_KEY == sk_test_* ]] || [[ $STRIPE_TEST_KEY == rk_test_* ]]; then
        echo "✅ Test key format is valid"
    else
        echo "⚠️  Test key should start with 'sk_test_' or 'rk_test_'"
        echo "   Current key starts with: ${STRIPE_TEST_KEY:0:10}..."
    fi
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Stripe Test Environment
# Get your test key from: https://dashboard.stripe.com/test/apikeys
STRIPE_TEST_KEY=sk_test_your_test_key_here

# Optional: Set a default profile for testing
STRIPE_DEFAULT_PROFILE=test
EOF
    echo "✅ Created .env file with template"
    echo "   Please edit .env and add your actual Stripe test key"
else
    echo "✅ .env file already exists"
fi

# Create test profile if it doesn't exist
if [ ! -f .profile ]; then
    echo "📝 Creating test profile..."
    cat > .profile << EOF
[default]
profile=test

[test]
key=sk_test_your_test_key_here
description=Test environment for development

[production]
key=sk_live_your_live_key_here
description=Production environment (use with caution)
EOF
    echo "✅ Created .profile file with template"
    echo "   Please edit .profile and add your actual Stripe keys"
else
    echo "✅ .profile file already exists"
fi

# Run unit tests to verify setup
echo "🧪 Running unit tests to verify setup..."
npm run test:unit

if [ $? -eq 0 ]; then
    echo "✅ Unit tests passed"
else
    echo "❌ Unit tests failed. Please check the setup."
    exit 1
fi

# Run integration tests if key is available
if [ ! -z "$STRIPE_TEST_KEY" ] && [[ $STRIPE_TEST_KEY == sk_test_* ]]; then
    echo "🧪 Running integration tests..."
    npm run test:integration
    
    if [ $? -eq 0 ]; then
        echo "✅ Integration tests passed"
    else
        echo "⚠️  Integration tests failed. This might be due to network issues or invalid test key."
        echo "   Check your STRIPE_TEST_KEY and try again."
    fi
else
    echo "⏭️  Skipping integration tests (no valid test key)"
fi

echo ""
echo "🎉 Test environment setup complete!"
echo ""
echo "Available test commands:"
echo "  npm run test:unit        - Run unit tests only"
echo "  npm run test:integration - Run integration tests (requires STRIPE_TEST_KEY)"
echo "  npm test                 - Run all tests"
echo "  npm run test:coverage    - Run tests with coverage report"
echo ""
echo "To run integration tests:"
echo "  1. Get a test key from: https://dashboard.stripe.com/test/apikeys"
echo "  2. Set it: export STRIPE_TEST_KEY=sk_test_your_key_here"
echo "  3. Run: npm run test:integration"
