#!/usr/bin/env bash
#
# Secrets into SSM Parameter Store as SecureString.
#
# Parameters are encrypted with the AWS-managed key (alias/aws/ssm), which costs
# nothing, and standard parameters are free. Task definitions reference them by
# ARN, so no credential is ever written into an image, a task definition, or a
# log line.
#
# This script is deliberately non-destructive: if a parameter already exists it
# is left alone. Rotating the signing secret would invalidate every harness
# download in the field, so rotation is a separate, deliberate act.
#
#   ./15-secrets.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

put_if_absent() { # name value
  local name="$1" value="$2"
  if aws ssm get-parameter --name "$name" >/dev/null 2>&1; then
    note "$name already set, leaving it alone"
    return 0
  fi
  aws ssm put-parameter --name "$name" --value "$value" \
    --type SecureString --no-cli-pager >/dev/null
  note "$name created"
}

say "SSM parameters under ${SSM_PREFIX}/"

# Signs harness pack downloads. Changing it invalidates existing downloads.
put_if_absent "${SSM_PREFIX}/SIGNING_SECRET" "$(openssl rand -hex 32)"
# Verifies GitHub webhook deliveries. The portal refuses unsigned deliveries in
# production, so this must exist before real GitHub is connected.
put_if_absent "${SSM_PREFIX}/WEBHOOK_SECRET" "$(openssl rand -hex 32)"

say "secrets ready"
note "add STACK_GITHUB_TOKEN later, when the GitHub App is created:"
note "  aws ssm put-parameter --name ${SSM_PREFIX}/GITHUB_TOKEN --type SecureString --value <token>"
note "next: ./20-database.sh"
