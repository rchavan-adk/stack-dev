#!/usr/bin/env bash
#
# Application Load Balancer and path routing.
#
# One load balancer fronts all three services, distinguished by path, because a
# second load balancer would double the hourly charge for no benefit:
#
#   /mcp*   -> MCP server     (streamable HTTP, and the URL the CLI is pointed at)
#   /v1/*   -> model gateway  (Anthropic-shaped Messages API)
#   /*      -> portal         (everything else)
#
# The load balancer is the only thing in the whole stack that is internet
# facing, and even it only accepts connections from CloudFront's address ranges.
#
#   ./30-loadbalancer.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

SG_ALB_ID="$(sg_ensure "$SG_ALB_NAME" "CloudFront to Stack ALB")"
SG_TASK_ID="$(sg_ensure "$SG_TASK_NAME" "ALB to Stack ECS tasks")"

# ---------------------------------------------------------------------------
# Load balancer.
# ---------------------------------------------------------------------------
say "load balancer $ALB_NAME"
ALB_ARN="$(aws elbv2 describe-load-balancers --names "$ALB_NAME" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
  note "already exists"
else
  ALB_ARN="$(aws elbv2 create-load-balancer \
    --name "$ALB_NAME" \
    --type application \
    --scheme internet-facing \
    --subnets $SUBNET_IDS_LIST \
    --security-groups "$SG_ALB_ID" \
    --tags Key=Name,Value="$ALB_NAME" \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
  note "created"
fi
ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)"
note "dns $ALB_DNS"

# ---------------------------------------------------------------------------
# Target groups. Target type is `ip` because Fargate tasks have no instance to
# register; the ENI address is registered instead.
#
# Deregistration delay is dropped to 10 seconds so a deployment drains quickly
# instead of holding a connection open for the 5-minute default.
# ---------------------------------------------------------------------------
create_tg() { # name port health-path
  local name="$1" port="$2" path="$3" arn
  arn="$(tg_arn "$name")"
  if [ -n "$arn" ] && [ "$arn" != "None" ]; then
    # Converge the health check path rather than assuming it is already right.
    aws elbv2 modify-target-group --target-group-arn "$arn" \
      --health-check-path "$path" >/dev/null
    printf '%s' "$arn"; return 0
  fi
  arn="$(aws elbv2 create-target-group \
    --name "$name" --protocol HTTP --port "$port" \
    --vpc-id "$VPC_ID" --target-type ip \
    --health-check-protocol HTTP --health-check-path "$path" \
    --health-check-interval-seconds 30 --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Name,Value="$name" \
    --query 'TargetGroups[0].TargetGroupArn' --output text)"
  # Drain in 10 seconds instead of the 5-minute default, so a deployment
  # finishes in seconds rather than stalling on idle connections.
  aws elbv2 modify-target-group-attributes --target-group-arn "$arn" \
    --attributes Key=deregistration_delay.timeout_seconds,Value=10 >/dev/null
  printf '%s' "$arn"
}

say "target groups"
# The portal is probed at /api/health, not at /login. /login redirects to /setup
# while the deployment has no accounts yet, and a redirect is not a healthy
# response to a load balancer.
TG_PORTAL_ARN="$(create_tg "$TG_PORTAL" 4200 /api/health)"
note "$TG_PORTAL -> :4200 /api/health"
TG_MCP_ARN="$(create_tg "$TG_MCP" 4300 /health)"
note "$TG_MCP -> :4300 /health"
TG_GATEWAY_ARN="$(create_tg "$TG_GATEWAY" 4400 /health)"
note "$TG_GATEWAY -> :4400 /health"

# ---------------------------------------------------------------------------
# Listener on port 80. CloudFront terminates TLS for viewers and talks to this
# listener over HTTP inside AWS; the load balancer itself is not reachable from
# the internet, so plain HTTP here is not an exposure.
# ---------------------------------------------------------------------------
say "listener and path rules"
LISTENER_ARN="$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`80`].ListenerArn' --output text 2>/dev/null || true)"
if [ -n "$LISTENER_ARN" ] && [ "$LISTENER_ARN" != "None" ]; then
  note "listener on 80 already exists"
else
  LISTENER_ARN="$(aws elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
    --default-actions Type=forward,TargetGroupArn="$TG_PORTAL_ARN" \
    --query 'Listeners[0].ListenerArn' --output text)"
  note "created, default action forwards to the portal"
fi

# Rules are keyed by priority, so re-running updates rather than duplicates.
upsert_rule() { # priority path-pattern tg-arn
  local priority="$1" pattern="$2" target="$3" existing
  existing="$(aws elbv2 describe-rules --listener-arn "$LISTENER_ARN" \
    --query "Rules[?Priority=='$priority'].RuleArn" --output text 2>/dev/null || true)"
  if [ -n "$existing" ] && [ "$existing" != "None" ]; then
    aws elbv2 modify-rule --rule-arn "$existing" \
      --conditions "Field=path-pattern,Values=$pattern" \
      --actions Type=forward,TargetGroupArn="$target" >/dev/null
  else
    aws elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority "$priority" \
      --conditions "Field=path-pattern,Values=$pattern" \
      --actions Type=forward,TargetGroupArn="$target" >/dev/null
  fi
  note "priority $priority  $pattern -> $target"
}

upsert_rule 10 "/mcp" "$TG_MCP_ARN"
upsert_rule 11 "/mcp/*" "$TG_MCP_ARN"
upsert_rule 20 "/v1/*" "$TG_GATEWAY_ARN"

say "load balancer ready"
note "next: ./40-cdn.sh"
