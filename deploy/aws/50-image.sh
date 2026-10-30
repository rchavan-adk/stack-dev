#!/usr/bin/env bash
#
# Build the image for Fargate's ARM64 runtime and push it to ECR.
#
# Building on this machine rather than in the cloud keeps the loop short and
# costs nothing. The image is built for linux/arm64 because Graviton is the
# cheaper Fargate dimension ($0.03238 vs $0.04048 per vCPU-hour).
#
# Provenance and SBOM attestations are turned off deliberately. Buildx attaches
# them by default, which turns the push into a multi-architecture image index.
# ECS pulls a single-platform image and the index adds nothing but risk.
#
#   ./50-image.sh

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

say "logging in to ECR"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_HOST" >/dev/null
note "authenticated to $ECR_HOST"

# A docker-container builder is used rather than the default docker driver
# because it handles --platform together with --push predictably.
if ! docker buildx inspect "$PREFIX-builder" >/dev/null 2>&1; then
  say "creating buildx builder $PREFIX-builder"
  docker buildx create --name "$PREFIX-builder" --driver docker-container >/dev/null
fi
docker buildx use "$PREFIX-builder" >/dev/null
docker buildx inspect --bootstrap >/dev/null 2>&1 || true

say "building and pushing $IMAGE_URI:$IMAGE_TAG (linux/arm64)"
docker buildx build \
  --platform linux/arm64 \
  --provenance=false \
  --sbom=false \
  --tag "$IMAGE_URI:$IMAGE_TAG" \
  --tag "$IMAGE_URI:latest" \
  --push \
  "$REPO_ROOT"

DIGEST="$(aws ecr describe-images --repository-name "$ECR_REPO" \
  --image-ids "imageTag=$IMAGE_TAG" \
  --query 'imageDetails[0].imageDigest' --output text)"

say "image pushed"
note "tag    $IMAGE_TAG"
note "digest $DIGEST"
note "next: ./60-services.sh"
