#!/bin/bash

# test_local.sh - Automate local testing for Inheritance Demo

# Ensure we are in the project root
cd "$(dirname "$0")"

echo "🔄 Switching Anchor.toml to localnet..."
sed -i '' 's/cluster = "devnet"/cluster = "localnet"/g' Anchor.toml

echo "🚀 Running Anchor tests..."

# Run anchor test
anchor test

# Check exit status
TEST_RESULT=$?

echo "🔄 Restoring Anchor.toml to devnet..."
sed -i '' 's/cluster = "localnet"/cluster = "devnet"/g' Anchor.toml

if [ $TEST_RESULT -eq 0 ]; then
    echo "✅ SUCCESS: All tests passed on local validator."
else
    echo "❌ FAILURE: Some tests failed. Check the output above."
fi

exit $TEST_RESULT
