#!/usr/bin/env bash
#
# Shared settings for the Stack AI deployment.
#
# Everything these scripts create is named with a single prefix, so teardown can
# find exactly what belongs to this stack and nothing else in the account.
#
# Nothing here is secret. Credentials live in SSM Parameter Store (SecureString)
# and are only ever referenced by ARN from a task definition.

set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-stack}"
export AWS_REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"

export PREFIX="${PREFIX:-stack}"
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

export REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export IMAGE_TAG="${IMAGE_TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD)}"

# --- registry -----------------------------------------------------------------
export ECR_REPO="${PREFIX}-app"
export ECR_HOST="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_URI="${ECR_HOST}/${ECR_REPO}"

# --- compute ------------------------------------------------------------------
export CLUSTER="${PREFIX}"
export LOG_GROUP="/ecs/${PREFIX}"
export EXEC_ROLE="${PREFIX}EcsTaskExecutionRole"
export TASK_ROLE="${PREFIX}EcsTaskRole"

# --- network ------------------------------------------------------------------
export ALB_NAME="${PREFIX}-alb"
export TG_PORTAL="${PREFIX}-portal-tg"
export TG_MCP="${PREFIX}-mcp-tg"
export SG_ALB_NAME="${PREFIX}-alb-sg"
export SG_TASK_NAME="${PREFIX}-task-sg"
export SG_DB_NAME="${PREFIX}-db-sg"
# AWS's own list of the addresses CloudFront serves origins from, so the load
# balancer is reachable by the CDN and by nothing else.
export CLOUDFRONT_PREFIX_LIST="pl-b6a144df"

# --- database -----------------------------------------------------------------
export DB_ID="${PREFIX}-db"
export DB_NAME="stack"
export DB_USER="stackadmin"
export DB_SUBNET_GROUP="${PREFIX}-db-subnets"
export DB_CLASS="${DB_CLASS:-db.t4g.micro}"
export DB_VERSION="${DB_VERSION:-16.13}"

# --- parameters ---------------------------------------------------------------
export SSM_PREFIX="/${PREFIX}"

# --- task sizing --------------------------------------------------------------
# Graviton in us-east-2: $0.03238 per vCPU-hour, $0.00356 per GB-hour. Portal
# gets more room because Next.js serves HTML and holds a session; the MCP
# service is thin.
export PORTAL_CPU=512   PORTAL_MEM=1024
export MCP_CPU=256      MCP_MEM=512

# --- helpers ------------------------------------------------------------------
say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

# Resolve the default VPC and its subnets. The account has no custom networking,
# and default subnets are public, which keeps image pulls and outbound calls
# simple without a NAT gateway.
export VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
export SUBNET_IDS_LIST="$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ' ')"
export SUBNET_IDS_CSV="$(printf '%s' "$SUBNET_IDS_LIST" | tr ' ' ',')"

# Find a security group by name in the default VPC, or create it. Returns the id.
sg_ensure() {
  local name="$1" description="$2" id
  id="$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    id="$(aws ec2 create-security-group --group-name "$name" \
      --description "$description" --vpc-id "$VPC_ID" \
      --query 'GroupId' --output text)"
    aws ec2 create-tags --resources "$id" --tags "Key=Name,Value=$name"
  fi
  printf '%s' "$id"
}

# Add an ingress rule, tolerating the case where it already exists.
sg_allow() {
  local group="$1"; shift
  aws ec2 authorize-security-group-ingress --group-id "$group" "$@" >/dev/null 2>&1 \
    || note "(rule already present)"
}

# Look up a target group ARN by name.
tg_arn() {
  aws elbv2 describe-target-groups --names "$1" \
    --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true
}
