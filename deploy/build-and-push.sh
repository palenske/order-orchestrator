#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-sa-east-1}"
ECR_REPOSITORY="${ECR_REPOSITORY:-order-orchestrator}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

docker build -t "${ECR_REPOSITORY}:${IMAGE_TAG}" ..

docker tag "${ECR_REPOSITORY}:${IMAGE_TAG}" "${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo "Image pushed: ${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
