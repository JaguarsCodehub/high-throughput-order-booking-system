#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════"
echo "  V0 DEPLOYMENT: Intentionally Broken Kubernetes Deploy"
echo "════════════════════════════════════════════════════════════"

echo "[STEP 1] Building Docker images..."
docker build -t order-service:latest --build-arg SERVICE_NAME=order-service .
echo "✓ order-service image built"
docker build -t inventory-service:latest --build-arg SERVICE_NAME=inventory-service .
echo "✓ inventory-service image built"
docker build -t payment-service:latest --build-arg SERVICE_NAME=payment-service .
echo "✓ payment-service image built"
docker build -t notification-service:latest --build-arg SERVICE_NAME=notification-service .
echo "✓ notification-service image built"

echo "[STEP 2] Loading images into KIND cluster..."
kind load docker-image order-service:latest --name order-booking
kind load docker-image inventory-service:latest --name order-booking
kind load docker-image payment-service:latest --name order-booking
kind load docker-image notification-service:latest --name order-booking
echo "✓ All images loaded to KIND"

echo "[STEP 3] Deploying to Kubernetes..."
kubectl apply -f k8s/v0-namespace.yaml
echo "✓ Namespace created"

kubectl apply -f k8s/v0-configmap.yaml
kubectl apply -f k8s/v0-secret.yaml
echo "✓ ConfigMap and Secrets deployed"

kubectl apply -f k8s/v0-kafka.yaml
echo "✓ Kafka deployed"

echo "⏳ Waiting for Kafka to be ready (if this times out, that's okay for V0)..."
kubectl wait --for=condition=ready pod -l app=kafka -n obs-v0 --timeout=120s || true

kubectl apply -f k8s/v0-order-service.yaml
kubectl apply -f k8s/v0-inventory-service.yaml
kubectl apply -f k8s/v0-payment-service.yaml
kubectl apply -f k8s/v0-notification-service.yaml
echo "✓ All services deployed"

# Database initialization isn't needed here because we are using an external Supabase database.
# The user's Supabase DB should already be initialized.
echo "✓ Database uses external Supabase (assume initialized)"

echo "[STEP 4] Deployment Status:"
echo "────────────────────────────────────────────────────────────"
kubectl get pods -n obs-v0

echo ""
echo "[READY] You can now test with:"
echo "  curl http://localhost:30001/health"
echo "  curl -X POST http://localhost:30001/api/orders -H 'Content-Type: application/json' -d '{\"userId\":\"00000000-0000-0000-0000-000000000001\",\"items\":[{\"productId\":\"00000000-0000-0000-0000-000000000002\",\"quantity\":5,\"unitPrice\":100}],\"totalAmount\":500}'"
