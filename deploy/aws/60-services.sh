#!/usr/bin/env bash
#
# Task definitions, the schema migration, and the three long-running services.
#
# Order matters: the migration runs to completion before any service starts, so
# a service can never boot against a schema that does not exist yet.
#
# Nothing is seeded. The demo seed in packages/db creates fixed API tokens that
# are published in the repository; running it here would create working
# credentials that anyone with the source could use. A fresh deployment is
# bootstrapped through /setup instead, which creates exactly one administrator
# and then closes itself.
#
#   ./60-services.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

PUBLIC_URL="$(aws ssm get-parameter --name "${SSM_PREFIX}/PUBLIC_URL" \
  --query 'Parameter.Value' --output text)"
PARAM_PREFIX="arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter${SSM_PREFIX}"
EXEC_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${EXEC_ROLE}"
TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${TASK_ROLE}"
SG_TASK_ID="$(sg_ensure "$SG_TASK_NAME" "ALB to Stack ECS tasks")"

note "public url  $PUBLIC_URL"
note "image       $IMAGE_URI:$IMAGE_TAG"

register() { # taskdefs/<name>.json
  local template="$1" rendered family
  rendered="$(mktemp)"
  sed -e "s|__IMAGE_URI__|${IMAGE_URI}|g" \
      -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
      -e "s|__EXEC_ROLE__|${EXEC_ROLE_ARN}|g" \
      -e "s|__TASK_ROLE__|${TASK_ROLE_ARN}|g" \
      -e "s|__LOG_GROUP__|${LOG_GROUP}|g" \
      -e "s|__REGION__|${AWS_REGION}|g" \
      -e "s|__PARAM_PREFIX__|${PARAM_PREFIX}|g" \
      -e "s|__PUBLIC_URL__|${PUBLIC_URL}|g" \
      "$template" > "$rendered"
  family="$(basename "$template" .json)"
  aws ecs register-task-definition --cli-input-json "file://$rendered" \
    --query 'taskDefinition.{family:family,revision:revision}' --output text
  rm -f "$rendered"
}

say "registering task definitions"
for app in portal mcp gateway migrate; do
  note "$(register "$(dirname "${BASH_SOURCE[0]}")/taskdefs/$app.json")"
done

# ---------------------------------------------------------------------------
# Migration, as a one-off task. This is what replaces "SSH in and run it".
# ---------------------------------------------------------------------------
say "running the schema migration"
MIGRATE_TASK="$(aws ecs run-task --cluster "$CLUSTER" \
  --task-definition "${PREFIX}-migrate" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS_CSV],securityGroups=[$SG_TASK_ID],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
note "task $MIGRATE_TASK"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$MIGRATE_TASK"

MIGRATE_EXIT="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$MIGRATE_TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$MIGRATE_EXIT" != "0" ]; then
  printf '\n\033[31mMigration failed with exit code %s. Last log lines:\033[0m\n' "$MIGRATE_EXIT"
  aws logs tail "$LOG_GROUP" --since 10m --filter-pattern migrate 2>/dev/null | tail -n 30 || true
  exit 1
fi
note "migration applied cleanly"

# ---------------------------------------------------------------------------
# Services. One task each: this is a demonstration deployment, and a second task
# would double the cost to buy redundancy the audience cannot see.
#
# The circuit breaker is on, so a task that cannot start is rolled back instead
# of retrying forever and burning money.
# ---------------------------------------------------------------------------
create_service() { # name target-group-arn container-name container-port
  local name="$1" tg="$2" cname="$3" cport="$4" active
  active="$(aws ecs describe-services --cluster "$CLUSTER" --services "$name" \
    --query 'services[?status==`ACTIVE`].serviceName' --output text 2>/dev/null || true)"
  if [ -n "$active" ] && [ "$active" != "None" ]; then
    note "$name exists; rolling a new deployment"
    aws ecs update-service --cluster "$CLUSTER" --service "$name" \
      --task-definition "$name" --force-new-deployment >/dev/null
    return 0
  fi
  aws ecs create-service \
    --cluster "$CLUSTER" --service-name "$name" \
    --task-definition "$name" --desired-count 1 --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS_CSV],securityGroups=[$SG_TASK_ID],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=$tg,containerName=$cname,containerPort=$cport" \
    --health-check-grace-period-seconds 60 \
    --deployment-configuration 'maximumPercent=200,minimumHealthyPercent=100,deploymentCircuitBreaker={enable=true,rollback=true}' \
    >/dev/null
  note "$name created"
}

say "creating services"
create_service "${PREFIX}-portal"  "$(tg_arn "$TG_PORTAL")"  portal  4200
create_service "${PREFIX}-mcp"     "$(tg_arn "$TG_MCP")"     mcp     4300
create_service "${PREFIX}-gateway" "$(tg_arn "$TG_GATEWAY")" gateway 4400

say "waiting for the services to stabilise (this takes a few minutes)"
aws ecs wait services-stable --cluster "$CLUSTER" \
  --services "${PREFIX}-portal" "${PREFIX}-mcp" "${PREFIX}-gateway"
note "all three services stable"

# ---------------------------------------------------------------------------
# Prove it answers. The portal is checked through the CDN, which is the same
# path a user takes, so this exercises TLS, CloudFront, the load balancer and
# routing rather than just the task.
#
# The MCP and gateway services cannot be exercised yet: every one of their
# routes requires an API token, and a fresh deployment deliberately has none.
# Their target health is what confirms the process is up and answering on the
# right port, which is exactly the failure this catches.
# ---------------------------------------------------------------------------
say "checking the public endpoints"
PORTAL_CODE=""
for _ in $(seq 1 20); do
  PORTAL_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${PUBLIC_URL}/api/health" || true)"
  [ "$PORTAL_CODE" = "200" ] && break
  note "portal answered $PORTAL_CODE, retrying in 15s"
  sleep 15
done
if [ "$PORTAL_CODE" = "200" ]; then
  note "portal   ${PUBLIC_URL}/api/health   HTTP 200"
else
  printf '    \033[31mportal   %s/api/health   HTTP %s\033[0m\n' "$PUBLIC_URL" "$PORTAL_CODE"
fi

for pair in "$TG_PORTAL:portal" "$TG_MCP:mcp" "$TG_GATEWAY:gateway"; do
  tg="${pair%%:*}"; label="${pair##*:}"
  arn="$(tg_arn "$tg")"
  health="$(aws elbv2 describe-target-health --target-group-arn "$arn" \
    --query 'TargetHealthDescriptions[].TargetHealth.State' --output text 2>/dev/null || true)"
  note "$label target health: $health"
done

say "deployed"
note "portal  $PUBLIC_URL"
note "mcp     $PUBLIC_URL/mcp"
note "gateway $PUBLIC_URL/v1/messages"
note ""
note "The database is empty by design. Open $PUBLIC_URL/setup to create the"
note "first administrator, which closes the setup route behind you. Then run"
note "./70-bootstrap.sh to install the templates and the default harness pack."
