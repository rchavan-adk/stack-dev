#!/usr/bin/env bash
#
# CloudFront, for HTTPS without owning a domain.
#
# Why this exists: an ALB can only serve HTTPS with an ACM certificate, and ACM
# can only validate a certificate against a domain you control. This account has
# no domain. CloudFront ships with a certificate for its own domain at no extra
# cost, and its free tier (1 TB out, 10 million requests per month) covers this
# deployment entirely.
#
# Caching is disabled and every viewer header is forwarded, because every route
# here is either authenticated, a stream, or an API call. Compress is off for the
# same reason: compressing an event stream buffers it.
#
#   ./40-cdn.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

ALB_ARN="$(aws elbv2 describe-load-balancers --names "$ALB_NAME" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)"
note "origin $ALB_DNS"

# The comment is the tag this stack uses to find its own distribution again, so
# re-running does not create a second one.
EXISTING_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='${PREFIX}-ai'].Id" --output text 2>/dev/null || true)"

if [ -n "$EXISTING_ID" ] && [ "$EXISTING_ID" != "None" ]; then
  say "distribution already exists"
  DIST_ID="$EXISTING_ID"
else
  say "creating distribution"
  CONFIG_FILE="$(mktemp)"
  cat > "$CONFIG_FILE" <<JSON
{
  "CallerReference": "${PREFIX}-${IMAGE_TAG}-$(date +%s)",
  "Comment": "${PREFIX}-ai",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "PriceClass": "PriceClass_100",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "${PREFIX}-alb-origin",
        "DomainName": "${ALB_DNS}",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
          "OriginReadTimeout": 60,
          "OriginKeepaliveTimeout": 5
        },
        "CustomHeaders": {
          "Quantity": 1,
          "Items": [
            {"HeaderName": "X-Forwarded-Proto", "HeaderValue": "https"}
          ]
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "${PREFIX}-alb-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}
    },
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3",
    "Compress": false,
    "SmoothStreaming": false
  },
  "ViewerCertificate": {"CloudFrontDefaultCertificate": true},
  "Restrictions": {"GeoRestriction": {"RestrictionType": "none", "Quantity": 0}}
}
JSON
  DIST_ID="$(aws cloudfront create-distribution \
    --distribution-config "file://$CONFIG_FILE" \
    --query 'Distribution.Id' --output text)"
  rm -f "$CONFIG_FILE"
  note "created $DIST_ID"
fi

say "waiting for the distribution to deploy (several minutes)"
aws cloudfront wait distribution-deployed --id "$DIST_ID"

PUBLIC_DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" \
  --query 'Distribution.DomainName' --output text)"
PUBLIC_URL="https://${PUBLIC_DOMAIN}"

# Stored so the task definitions and the CLI can both find the public entry
# point without hard-coding it.
aws ssm put-parameter --name "${SSM_PREFIX}/PUBLIC_URL" --value "$PUBLIC_URL" \
  --type String --overwrite --no-cli-pager >/dev/null

say "CDN ready"
note "public url  $PUBLIC_URL"
note "stored in   ${SSM_PREFIX}/PUBLIC_URL"
note "next: ./50-image.sh"
