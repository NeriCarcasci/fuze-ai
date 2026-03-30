#!/usr/bin/env bash
set -e

echo "=== Fuze AI Examples: Local Setup ==="
echo ""

# 1. Build the core TypeScript package
echo "Building packages/core..."
cd "$(dirname "$0")/.."
npm run build --workspace=packages/core
echo "  Done."
echo ""

# 2. Install TypeScript example dependencies (uses file: link to local core)
echo "Installing TypeScript example dependencies..."
for dir in examples/typescript/0[1-5]-*/; do
  echo "  $dir"
  cd "$dir"
  npm install --no-audit --no-fund 2>/dev/null
  cd "$(dirname "$0")/.."
done
echo "  Done."
echo ""

# 3. Install Python package in editable mode
if [ -d "D:/fuze-python" ] || [ -d "/d/fuze-python" ]; then
  PYDIR="${PYDIR:-D:/fuze-python}"
  echo "Installing fuze-python in editable mode..."
  pip install -e "$PYDIR" 2>/dev/null || pip install -e "/d/fuze-python" 2>/dev/null
  echo "  Done."
else
  echo "SKIP: D:/fuze-python not found. Python examples won't work."
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Run TypeScript examples:"
echo "  cd examples/typescript/01-basic-guard && npm start"
echo ""
echo "Run Python examples:"
echo "  cd examples/python/01-basic-guard && python main.py"
