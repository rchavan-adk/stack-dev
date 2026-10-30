#!/usr/bin/env bash
#
# Install the product defaults, as a one-off task.
#
# Run this AFTER creating the first administrator at /setup. The templates and
# the default harness pack are published by that administrator, so there has to
# be one first.
#
# This is deliberately separate from the deployment. The schema migration has to
# run before the services start; this has to run after a human has created an
# account.
#
#   ./70-bootstrap.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

PUBLIC_URL="$(aws ssm get-parameter --name "${SSM_PREFIX}/PUBLIC_URL" \
  --query 'Parameter.Value' --output text)"
PARAM_PREFIX="arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter${SSM_PREFIX}"
EXEC_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${EXEC_ROLE}"
TASK_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${TASK_ROLE}"
SG_TASK_ID="$(sg_ensure "$SG_TASK_NAME" "ALB to Stack ECS tasks")"

rendered="$(mktemp)"
sed -e "s|__IMAGE_URI__|${IMAGE_URI}|g" \
    -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
    -e "s|__EXEC_ROLE__|${EXEC_ROLE_ARN}|g" \
    -e "s|__TASK_ROLE__|${TASK_ROLE_ARN}|g" \
    -e "s|__LOG_GROUP__|${LOG_GROUP}|g" \
    -e "s|__REGION__|${AWS_REGION}|g" \
    -e "s|__PARAM_PREFIX__|${PARAM_PREFIX}|g" \
    -e "s|__PUBLIC_URL__|${PUBLIC_URL}|g" \
    "$(dirname "${BASH_SOURCE[0]}")/taskdefs/bootstrap.json" > "$rendered"

say "registering stack-bootstrap"
aws ecs register-task-definition --cli-input-json "file://$rendered" \
  --query 'taskDefinition.{family:family,revision:revision}' --output text | sed 's/^/    /'
rm -f "$rendered"

say "running the bootstrap task"
TASK_ARN="$(aws ecs run-task --cluster "$CLUSTER" \
  --task-definition "${PREFIX}-bootstrap" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS_CSV],securityGroups=[$SG_TASK_ID],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
note "task $TASK_ARN"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"

say "bootstrap log"
aws logs tail "$LOG_GROUP" --since 5m --filter-pattern bootstrap 2>/dev/null | tail -n 15 || true

if [ "$EXIT_CODE" != "0" ]; then
  printf '\n\033[31mBootstrap failed with exit code %s.\033[0m\n' "$EXIT_CODE"
  note "if it says no administrator exists, create one at ${PUBLIC_URL}/setup first"
  exit 1
fi

note "product defaults installed"
