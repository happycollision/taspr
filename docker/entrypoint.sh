#!/bin/bash
set -e

cd /workspace

# Configure gh CLI as git credential helper (if GH_TOKEN is set)
# This enables git push/pull to work with GitHub repos cloned via HTTPS
if [ -n "$GH_TOKEN" ]; then
    gh auth setup-git 2>/dev/null || true
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    bun install
fi

# Build sp if not present
if [ ! -f "dist/sp" ]; then
    echo "Building sp..."
    bun run build
fi

# Run the command (default: bash)
exec "$@"
