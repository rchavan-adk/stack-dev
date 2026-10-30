#!/usr/bin/env bash
#
# Delete everything this stack created, in dependency order.
#
# This exists because the deployment is paid for from a credit balance: an
# afternoon of experimentation should not keep costing money afterwards. It
# removes only resources named with the stack prefix, and it refuses to run
# without an explicit confirmation.
#
#   CONFIRM=yes ./99-teardown.sh
#
# The database is destroyed with no final snapshot. That is the point of a
# teardown script, so it is guarded rather than silent.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

if [ "${CONFIRM:-}" != "yes" ]; then
  cat <<'MSG'
This deletes the Stack AI deployment, including its database and all data in it.

Re-run with an explicit confirmation:

  CONFIRM=yes ./99-teardown.sh
MSG
  exit 1
fi

delete_quietly() { # description, command...
  local what="$1"; shift
  if "$@" >/dev/null 2>&1; then
    note "deleted $what"
  else
    note "$what: already gone or not deletable yet"
  fi
}

# ---------------------------------------------------------------------------
# 1. Services first, so nothing is left trying to start a task against
#    resources that are being removed.
# ---------------------------------------------------------------------------
say "ECS services"
for svc in "${PREFIX}-portal" "${PREFIX}-mcp"; do
  aws ecs update-service --cluster "$CLUSTER" --service "$svc" --desired-count 0 >/dev/null 2>&1 || true
  delete_quietly "$svc" aws ecs delete-service --cluster "$CLUSTER" --service "$svc" --force
done

say "ECS cluster and task definitions"
delete_quietly "cluster $CLUSTER" aws ecs delete-cluster --cluster "$CLUSTER"
for app in portal mcp migrate bootstrap; do
  for rev in $(aws ecs list-task-definitions --family-prefix "${PREFIX}-${app}" \
      --query 'taskDefinitionArns[]' --output text 2>/dev/null); do
    aws ecs deregister-task-definition --task-definition "$rev" >/dev/null 2>&1 || true
  done
done
note "task definitions deregistered"

# ---------------------------------------------------------------------------
# 2. The CDN. CloudFront will not delete an enabled distribution, so it has to
#    be disabled and given time to propagate first. This is the slow part.
# ---------------------------------------------------------------------------
say "CloudFront"
DIST_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='${PREFIX}-ai'].Id" --output text 2>/dev/null || true)"
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
  ETAG="$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)"
  aws cloudfront get-distribution-config --id "$DIST_ID" \
    --query 'DistributionConfig' --output text >/dev/null 2>&1 || true
  aws cloudfront get-distribution-config --id "$DIST_ID" \
    --query 'DistributionConfig' --output json \
    | python3 -c 'import json,sys; c=json.load(sys.stdin); c["Enabled"]=False; print(json.dumps(c))' \
    > /tmp/stack-cf-disabled.json
  aws cloudfront update-distribution --id "$DIST_ID" \
    --distribution-config file:///tmp/stack-cf-disabled.json --if-match "$ETAG" >/dev/null
  rm -f /tmp/stack-cf-disabled.json
  note "disabled $DIST_ID, waiting for it to propagate"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"
  ETAG="$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)"
  aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG" >/dev/null
  note "deleted $DIST_ID"
else
  note "no distribution found"
fi

# ---------------------------------------------------------------------------
# 3. Load balancer, then the database.
# ---------------------------------------------------------------------------
say "load balancer"
ALB_ARN="$(aws elbv2 describe-load-balancers --names "$ALB_NAME" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
  delete_quietly "load balancer" aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"
  # Deletion is asynchronous: the target groups cannot be deleted until the
  # balancer is gone, so wait here rather than leaving them behind as
  # "not deletable yet".
  aws elbv2 wait load-balancers-deleted --load-balancer-arns "$ALB_ARN" || true
fi
for tg in "$TG_PORTAL" "$TG_MCP"; do
  arn="$(tg_arn "$tg")"
  if [ -n "$arn" ] && [ "$arn" != "None" ]; then
    delete_quietly "target group $tg" aws elbv2 delete-target-group --target-group-arn "$arn"
  fi
done

say "RDS"
if aws rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  aws rds delete-db-instance --db-instance-identifier "$DB_ID" \
    --skip-final-snapshot --delete-automated-backups >/dev/null
  note "deletion started; waiting for it to finish"
  aws rds wait db-instance-deleted --db-instance-identifier "$DB_ID"
  note "deleted $DB_ID"
else
  note "instance already gone"
fi
delete_quietly "subnet group" aws rds delete-db-subnet-group --db-subnet-group-name "$DB_SUBNET_GROUP"

# ---------------------------------------------------------------------------
# 4. Registry, logs, parameters, network, IAM.
# ---------------------------------------------------------------------------
say "registry and logs"
delete_quietly "ECR repository $ECR_REPO" aws ecr delete-repository --repository-name "$ECR_REPO" --force
delete_quietly "log group $LOG_GROUP" aws logs delete-log-group --log-group-name "$LOG_GROUP"

say "SSM parameters"
for name in SIGNING_SECRET WEBHOOK_SECRET DB_PASSWORD DATABASE_URL GITHUB_TOKEN PUBLIC_URL; do
  aws ssm delete-parameter --name "${SSM_PREFIX}/${name}" >/dev/null 2>&1 \
    && note "deleted ${SSM_PREFIX}/${name}" || true
done

say "security groups"
for name in "$SG_ALB_NAME" "$SG_TASK_NAME" "$SG_DB_NAME"; do
  id="$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
  if [ -n "$id" ] && [ "$id" != "None" ]; then
    delete_quietly "$name" aws ec2 delete-security-group --group-id "$id"
  fi
done

say "IAM roles"
aws iam delete-role-policy --role-name "$EXEC_ROLE" --policy-name "${PREFIX}-read-parameters" >/dev/null 2>&1 || true
aws iam detach-role-policy --role-name "$EXEC_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null 2>&1 || true
delete_quietly "$EXEC_ROLE" aws iam delete-role --role-name "$EXEC_ROLE"
delete_quietly "$TASK_ROLE" aws iam delete-role --role-name "$TASK_ROLE"

say "teardown complete"
note "check the console for anything left behind, and verify in AWS Settings > Billing"
