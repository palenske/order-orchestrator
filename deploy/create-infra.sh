#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-sa-east-1}"

echo "=== Creating ECR repository ==="
aws ecr create-repository \
  --repository-name order-orchestrator \
  --region "${AWS_REGION}" 2>/dev/null || echo "Repository already exists"

echo "=== Creating ECS cluster ==="
aws ecs create-cluster \
  --cluster-name order-orchestrator \
  --region "${AWS_REGION}" 2>/dev/null || echo "Cluster already exists"

echo "=== Registering ECS task definition ==="
aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --region "${AWS_REGION}"

echo "=== Creating ECS service ==="
aws ecs create-service \
  --cluster order-orchestrator \
  --service-name order-orchestrator-api \
  --task-definition order-orchestrator-api \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[SUBNET_ID],securityGroups=[SG_ID],assignPublicIp=ENABLED}" \
  --region "${AWS_REGION}" 2>/dev/null || echo "Service already exists, updating..."

aws ecs update-service \
  --cluster order-orchestrator \
  --service order-orchestrator-api \
  --task-definition order-orchestrator-api \
  --force-new-deployment \
  --region "${AWS_REGION}"

echo "=== Done ==="
