#!/usr/bin/env bash
#
# RDS Postgres.
#
# A managed database is the one piece here that genuinely benefits from being
# managed: automated backups, minor-version patching, and a failover story we
# would otherwise have to build. It is not reachable from the internet; only the
# ECS tasks' security group can open a connection.
#
# The master password is generated here, never printed, and goes straight into
# SSM. This script can be re-run safely.
#
#   ./20-database.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

SG_DB_ID="$(sg_ensure "$SG_DB_NAME" "Stack ECS tasks to RDS Postgres")"

# ---------------------------------------------------------------------------
# Subnet group: which subnets RDS may place the instance in. Using all three
# default subnets means RDS picks an Availability Zone for us.
# ---------------------------------------------------------------------------
say "DB subnet group $DB_SUBNET_GROUP"
if aws rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP" >/dev/null 2>&1; then
  note "already exists"
else
  aws rds create-db-subnet-group \
    --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --db-subnet-group-description "Stack AI: default VPC subnets" \
    --subnet-ids $SUBNET_IDS_LIST >/dev/null
  note "created from $SUBNET_IDS_CSV"
fi

# ---------------------------------------------------------------------------
# Instance.
#
# 20 GB gp3 is the free-tier allowance. Storage autoscaling is deliberately left
# off: it would let the volume grow past what the free tier covers without
# asking. Performance Insights is off because it is billed per vCPU.
# ---------------------------------------------------------------------------
say "master password"
# Generated locally and stored in SSM; it is never printed and never passed on a
# command line that could end up in shell history. SSM holds the authoritative
# copy, which is what makes this script safely re-runnable.
if aws ssm get-parameter --name "${SSM_PREFIX}/DB_PASSWORD" >/dev/null 2>&1; then
  note "already in ${SSM_PREFIX}/DB_PASSWORD"
else
  aws ssm put-parameter --name "${SSM_PREFIX}/DB_PASSWORD" \
    --value "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)" \
    --type SecureString --no-cli-pager >/dev/null
  note "generated, stored in ${SSM_PREFIX}/DB_PASSWORD"
fi
DB_PASSWORD="$(aws ssm get-parameter --name "${SSM_PREFIX}/DB_PASSWORD" \
  --with-decryption --query 'Parameter.Value' --output text)"

say "RDS instance $DB_ID ($DB_CLASS, Postgres $DB_VERSION)"
if aws rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  note "already exists"
else
  # Backup retention is 1 day, not the usual 7: a free-plan project caps it
  # there and refuses to create the instance otherwise. Automated backups still
  # happen, they are simply kept for a day.
  aws rds create-db-instance \
    --db-instance-identifier "$DB_ID" \
    --db-instance-class "$DB_CLASS" \
    --engine postgres \
    --engine-version "$DB_VERSION" \
    --master-username "$DB_USER" \
    --master-user-password "$DB_PASSWORD" \
    --db-name "$DB_NAME" \
    --allocated-storage 20 \
    --storage-type gp3 \
    --storage-encrypted \
    --vpc-security-group-ids "$SG_DB_ID" \
    --db-subnet-group-name "$DB_SUBNET_GROUP" \
    --no-publicly-accessible \
    --backup-retention-period 1 \
    --no-deletion-protection \
    --no-enable-performance-insights \
    --auto-minor-version-upgrade \
    --tags Key=Name,Value="$DB_ID" >/dev/null
  note "creation started (this takes 5 to 10 minutes)"
fi

say "waiting for the instance to become available"
aws rds wait db-instance-available --db-instance-identifier "$DB_ID"

# Make SSM the single source of truth. If the instance was created by an earlier
# partial run, or the password was rotated in SSM, this brings the two back into
# agreement instead of silently holding a stale credential.
say "aligning the master password with SSM"
aws rds modify-db-instance --db-instance-identifier "$DB_ID" \
  --master-user-password "$DB_PASSWORD" --apply-immediately >/dev/null
note "password matches ${SSM_PREFIX}/DB_PASSWORD"
DB_HOST="$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
DB_PORT="$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query 'DBInstances[0].Endpoint.Port' --output text)"
note "endpoint $DB_HOST:$DB_PORT"

# ---------------------------------------------------------------------------
# The connection string the services actually use. sslmode=require because the
# traffic crosses the VPC, and because RDS supports TLS at no cost.
# ---------------------------------------------------------------------------
say "connection string"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"
aws ssm put-parameter --name "${SSM_PREFIX}/DATABASE_URL" --value "$DATABASE_URL" \
  --type SecureString --overwrite --no-cli-pager >/dev/null
note "stored in ${SSM_PREFIX}/DATABASE_URL (password never printed)"

say "database ready"
note "next: ./30-loadbalancer.sh"
