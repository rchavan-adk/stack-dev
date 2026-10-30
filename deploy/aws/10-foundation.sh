#!/usr/bin/env bash
#
# Foundation: image registry, IAM roles, log group, security groups, ECS cluster.
#
# This is the layer that has to exist before anything can run. All of it is
# free or near-free; the resources that cost money are created by the next
# scripts.
#
#   ./10-foundation.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

note "account  $ACCOUNT_ID"
note "region   $AWS_REGION"
note "vpc      $VPC_ID"
note "subnets  $SUBNET_IDS_CSV"

# ---------------------------------------------------------------------------
# ECR — where the image lives. Scanning on push is free and catches known
# vulnerabilities in the base image; the lifecycle rule stops old images from
# accumulating against the 500 MB private-repository allowance.
# ---------------------------------------------------------------------------
say "ECR repository $ECR_REPO"
if aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  note "already exists"
else
  aws ecr create-repository --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability MUTABLE >/dev/null
  note "created"
fi
aws ecr put-lifecycle-policy --repository-name "$ECR_REPO" --lifecycle-policy-text '{
  "rules": [{
    "rulePriority": 1,
    "description": "keep the 10 most recent images",
    "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10},
    "action": {"type": "expire"}
  }]
}' >/dev/null
note "lifecycle: keep 10 most recent images"

# ---------------------------------------------------------------------------
# IAM.
#
# The execution role is used by the ECS agent itself: to pull the image and to
# read the SSM parameters that become container environment variables. It needs
# the AWS-managed policy plus read access scoped to this stack's parameter
# namespace only.
#
# The task role is what the application would use to call AWS APIs. The services
# call none, so it deliberately has no permissions attached. An empty role is
# the correct least-privilege answer here, not an oversight.
# ---------------------------------------------------------------------------
say "IAM roles"
if aws iam get-role --role-name "$EXEC_ROLE" >/dev/null 2>&1; then
  note "$EXEC_ROLE already exists"
else
  aws iam create-role --role-name "$EXEC_ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' >/dev/null
  note "created $EXEC_ROLE"
fi
aws iam attach-role-policy --role-name "$EXEC_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name "$EXEC_ROLE" \
  --policy-name "${PREFIX}-read-parameters" --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": [\"ssm:GetParameters\", \"ssm:GetParameter\"],
    \"Resource\": \"arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter${SSM_PREFIX}/*\"
  }]
}"
note "scoped SSM read to ${SSM_PREFIX}/*"

if aws iam get-role --role-name "$TASK_ROLE" >/dev/null 2>&1; then
  note "$TASK_ROLE already exists"
else
  aws iam create-role --role-name "$TASK_ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' >/dev/null
  note "created $TASK_ROLE (no permissions on purpose)"
fi

# ---------------------------------------------------------------------------
# Logs. Seven days is enough to debug a deployment and keeps the free tier
# (5 GB ingested per month) comfortably untouched.
# ---------------------------------------------------------------------------
say "CloudWatch log group $LOG_GROUP"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" \
     --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" --output text | grep -q .; then
  note "already exists"
else
  aws logs create-log-group --log-group-name "$LOG_GROUP"
  note "created"
fi
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 7
note "retention 7 days"

# ---------------------------------------------------------------------------
# Security groups. Three of them, each answering one question:
#
#   alb-sg    who may reach the load balancer  -> CloudFront's addresses only
#   task-sg   who may reach the services       -> the load balancer only
#   db-sg     who may reach Postgres           -> the services only
#
# Nothing is exposed to 0.0.0.0/0 except the load balancer port 80, and even
# that is restricted to the CDN's published address ranges rather than the
# whole internet.
# ---------------------------------------------------------------------------
say "Security groups"
SG_ALB_ID="$(sg_ensure "$SG_ALB_NAME" "CloudFront to Stack ALB")"
note "$SG_ALB_NAME = $SG_ALB_ID"
sg_allow "$SG_ALB_ID" --ip-permissions "[{
  \"IpProtocol\": \"tcp\", \"FromPort\": 80, \"ToPort\": 80,
  \"PrefixListIds\": [{\"PrefixListId\": \"$CLOUDFRONT_PREFIX_LIST\"}]
}]"

SG_TASK_ID="$(sg_ensure "$SG_TASK_NAME" "ALB to Stack ECS tasks")"
note "$SG_TASK_NAME = $SG_TASK_ID"
for port in 4200 4300 4400; do
  sg_allow "$SG_TASK_ID" --protocol tcp --port "$port" --source-group "$SG_ALB_ID"
done

SG_DB_ID="$(sg_ensure "$SG_DB_NAME" "Stack ECS tasks to RDS Postgres")"
note "$SG_DB_NAME = $SG_DB_ID"
sg_allow "$SG_DB_ID" --protocol tcp --port 5432 --source-group "$SG_TASK_ID"

# ---------------------------------------------------------------------------
# ECS cluster. A cluster is a namespace, not a server: it costs nothing and
# holds no capacity of its own under Fargate.
# ---------------------------------------------------------------------------
say "ECS cluster $CLUSTER"
if aws ecs describe-clusters --clusters "$CLUSTER" \
     --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
  note "already active"
else
  aws ecs create-cluster --cluster-name "$CLUSTER" \
    --capacity-providers FARGATE FARGATE_SPOT \
    --settings name=containerInsights,value=disabled >/dev/null
  note "created"
fi

say "foundation complete"
note "next: ./20-database.sh"
