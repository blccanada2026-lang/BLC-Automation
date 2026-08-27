#!/usr/bin/env bash
#
# Emergency rollback for the Payout Statement Summary deploy (TASK NEW-1).
# See docs/PROD_READINESS_PAYOUT_STATEMENT.md §5 for the full write-up of
# when to use this vs. the other two remedy paths (contained-to-new-feature,
# and real-financial-mistake) -- this script is ONLY for "the whole portal
# is broken and I need to restore the exact pre-deploy state now."
#
# What it does: reverts the merge commit that brought this feature into
# main, pushes the revert, and redeploys to PROD via clasp. It does NOT
# perform the "New Version" redeploy in the Apps Script editor -- that step
# is deliberately left manual, since picking the wrong deployment entry has
# caused real confusion on this project before (see PROJECT_MEMORY.md
# §3.9(c)); a script blindly guessing which deployment to update would be
# more dangerous than a clear reminder to do it by hand.

set -euo pipefail

# The merge commit that landed the Payout Statement Summary feature on main.
MERGE_COMMIT="4d14ac9"

echo "=================================================================="
echo " Payout Statement Summary -- EMERGENCY ROLLBACK"
echo "=================================================================="
echo "This will:"
echo "  1. git revert -m 1 ${MERGE_COMMIT}"
echo "  2. git push origin main"
echo "  3. npm run push:prod"
echo ""
echo "This does NOT undo any real payroll data already written --"
echo "FACT_PAYROLL_LEDGER is append-only. If a real financial mistake"
echo "happened (not a code bug), stop here and see docs/PROD_READINESS_PAYOUT_STATEMENT.md"
echo "§5's third case instead -- that needs a correction event, not a rollback."
echo "=================================================================="
read -r -p "Type 'rollback' to proceed: " CONFIRM
if [ "$CONFIRM" != "rollback" ]; then
  echo "Aborted -- no changes made."
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo ""
echo "--- git status before proceeding ---"
git status --short
if [ -n "$(git status --porcelain)" ]; then
  echo ""
  echo "WARNING: working tree is not clean. Review the above before continuing."
  read -r -p "Continue anyway? Type 'yes' to proceed: " DIRTY_CONFIRM
  if [ "$DIRTY_CONFIRM" != "yes" ]; then
    echo "Aborted -- no changes made."
    exit 1
  fi
fi

echo ""
echo "--- Step 1: reverting merge commit ${MERGE_COMMIT} ---"
git revert -m 1 --no-edit "${MERGE_COMMIT}"

echo ""
echo "--- Step 2: pushing revert to origin/main ---"
git push origin main

echo ""
echo "--- Step 3: deploying to PROD ---"
npm run push:prod

echo ""
echo "=================================================================="
echo " ROLLBACK PUSHED. ONE STEP LEFT -- DO THIS NOW:"
echo ""
echo "   Apps Script editor -> Deploy -> Manage deployments -> Edit"
echo "   -> New Version -> Deploy"
echo ""
echo "   Confirm you're redeploying the entry whose URL matches the"
echo "   PORTAL_BASE_URL Script Property -- not just the first one listed."
echo ""
echo " Then verify: portal loads, a real job round-trips, HealthMonitor"
echo " shows no new critical alerts."
echo "=================================================================="
