#!/bin/bash
# Runs the evaluation script and logs output to data/evaluation.log
# Run this script, then in a second terminal: tail -f data/evaluation.log

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_FILE="$SCRIPT_DIR/data/evaluation.log"

echo "Starting evaluation — log: $LOG_FILE"
echo "Watch progress in another terminal with:"
echo "  tail -f $LOG_FILE"
echo ""

python3 "$SCRIPT_DIR/scripts/evaluation/evaluate_imputation.py" 2>&1 | tee "$LOG_FILE"
