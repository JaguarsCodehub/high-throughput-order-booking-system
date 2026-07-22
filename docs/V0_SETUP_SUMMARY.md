# V0 Setup & Deployment Summary

## What We've Done

### 1. Code Changes (Minimal but necessary)
Added `/health` and `/ready` endpoints to all 4 services:
- **order-service**: checks Kafka producer + Postgres
- **inventory-service**: checks Kafka consumer/producer + Postgres (now has Express server)
- **payment-service**: checks Kafka consumer/producer + Postgres (now has Express server)
- **notification-service**: checks Kafka consumer + Postgres (now has Express server)

These endpoints are required for Kubernetes probes to work (even in v0, they exist but aren't used yet).

### 2. Kubernetes Manifests (V0 - Intentionally Broken)
Created in `/k8s/` directory:

| File | Purpose | Anti-patterns |
|------|---------|---|
| `v0-namespace.yaml` | Create `obs-v0` namespace | N/A |
| `v0-configmap.yaml` | Kafka/DB connection strings | N/A (good practice) |
| `v0-secret.yaml` | DB password | Plaintext in git (bad) |
| `v0-postgres.yaml` | Postgres Deployment + Service | No limits, no probes, no PVC |
| `v0-kafka.yaml` | Kafka (KRaft mode, no ZooKeeper) | No limits, no probes |
| `v0-order-service.yaml` | Order API Deployment + NodePort | No limits, no probes, `latest` tag, root user |
| `v0-inventory-service.yaml` | Inventory worker Deployment | No limits, no probes, `latest` tag |
| `v0-payment-service.yaml` | Payment worker Deployment | No limits, no probes, `latest` tag |
| `v0-notification-service.yaml` | Notification worker Deployment | No limits, no probes, `latest` tag |

### 3. Deployment Script
`scripts/v0-deploy.sh` - One-command deployment that:
1. Builds all 4 Docker images locally
2. Loads them into KIND cluster
3. Applies all Kubernetes manifests
4. Initializes the database
5. Reports service endpoints

---

## How to Execute V0

### Prerequisites (One-time on EC2)

```bash
# 1. Update and install Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
newgrp docker

# 2. Install kind, kubectl, helm, k6
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64
chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind

curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/kubectl

curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install -y k6

# 3. Verify all installed
kind --version
kubectl version --client
helm version
k6 version
```

### Create KIND Cluster (One-time)

```bash
mkdir -p ~/kind-setup
cat > ~/kind-setup/kind-config.yaml << 'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: order-booking
nodes:
  - role: control-plane
    image: kindest/node:v1.28.0
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
      - containerPort: 9092
        hostPort: 9092
        protocol: TCP
    extraMounts:
      - hostPath: /tmp/kind-data
        containerPath: /data
        readOnly: false
EOF

kind create cluster --config ~/kind-setup/kind-config.yaml

# Install ingress-nginx
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s
```

### Deploy V0 Application

```bash
cd ~/order-booking-system

# Build the project (if not already done)
npm install
npm run build

# Deploy everything
bash scripts/v0-deploy.sh
```

This takes ~2-3 minutes. You'll see:
```
✓ All images built
✓ All images loaded to KIND
✓ Namespace created
✓ ConfigMap and Secrets deployed
✓ Postgres deployed
⏳ Waiting for Postgres to be ready...
✓ Kafka deployed
⏳ Waiting for Kafka to be ready...
✓ All services deployed
✓ Database initialized

[READY] You can now test with:
  curl http://localhost:30001/health
  curl -X POST http://localhost:30001/api/orders ...
```

---

## Testing V0

### 1. Health Check (Should pass)
```bash
curl http://localhost:30001/health
# Output: {"status":"alive","service":"order-service"}
```

### 2. Create an Order (Should work initially)
```bash
curl -X POST http://localhost:30001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": 1,
    "items": [
      {"productId": 1, "quantity": 5, "unitPrice": 100}
    ],
    "totalAmount": 500
  }'
# Output: {"message":"Order placed successfully","orderId":"..."}
```

### 3. Load Test (Will crash the system)
```bash
# Monitor in one terminal
watch -n 1 'kubectl get pods -n obs-v0 -o wide'

# In another terminal, run load test
k6 run - << 'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  let payload = {
    userId: Math.floor(Math.random() * 1000),
    items: [
      {
        productId: Math.floor(Math.random() * 10) + 1,
        quantity: Math.floor(Math.random() * 5) + 1,
        unitPrice: Math.floor(Math.random() * 500) + 10,
      },
    ],
    totalAmount: Math.floor(Math.random() * 5000) + 100,
  };

  let res = http.post(
    'http://localhost:30001/api/orders',
    JSON.stringify(payload),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(res, {
    'status is 201': (r) => r.status === 201,
  });

  sleep(0.1);
}
EOF
```

### 4. Observe the Crash
```bash
# Check pod status - should show CrashLoopBackOff or OOMKilled
kubectl get pods -n obs-v0

# See details
kubectl describe pod -n obs-v0 -l app=order-service

# Check resource usage
kubectl top nodes
kubectl top pods -n obs-v0

# View events
kubectl get events -n obs-v0 --sort-by='.lastTimestamp' | tail -20

# Check EC2 host for OOM Killer
dmesg | tail -50
```

---

## Expected Failure Modes

### Scenario 1: Memory Exhaustion (Most Likely)
- **Cause**: No `resources.limits` on pods, load test creates unbounded connections
- **Symptom**: `kubectl top pods` shows order-service using 500MB+ on 2GB node
- **Result**: Pod OOMKilled, restarts immediately, crashes again (CrashLoopBackOff)

### Scenario 2: Cascading Failures
- **Cause**: No startup probes, services try to connect to Postgres/Kafka before they're ready
- **Symptom**: Inventory/Payment/Notification services in CrashLoopBackOff
- **Result**: Events pile up, system can't process orders end-to-end

### Scenario 3: Data Loss
- **Cause**: Postgres uses `emptyDir` (ephemeral storage)
- **Symptom**: If Postgres pod restarts, all data (orders, inventory) vanishes
- **Result**: Orphaned messages in Kafka, broken saga orchestration

### Scenario 4: High Latency / Timeouts
- **Cause**: Single replica, pod forced to restart repeatedly
- **Symptom**: 404/500 errors increasing, latency p99 → 30s+
- **Result**: Load test fails, user experience degraded

---

## Key Metrics to Capture (For Your Blog Post)

Before you delete v0, capture:

```bash
# 1. Pod status during crash
kubectl get pods -n obs-v0 -o json > v0-pods-crashed.json

# 2. Node resource usage
kubectl top nodes > v0-node-resources.txt

# 3. Events
kubectl get events -n obs-v0 --sort-by='.lastTimestamp' > v0-events.log

# 4. Pod descriptions (for OOMKilled reason)
kubectl describe pods -n obs-v0 > v0-pod-descriptions.log

# 5. Service logs
kubectl logs -n obs-v0 -l app=order-service --tail=100 > v0-order-logs.log
```

---

## Clean Up & Move to V1

```bash
# Delete v0 namespace (all resources deleted with it)
kubectl delete namespace obs-v0

# Delete the KIND cluster
kind delete cluster --name order-booking

# Clean up Docker images
docker rmi order-service:latest inventory-service:latest payment-service:latest notification-service:latest
```

Then, proceed to **V1 Deployment** which will fix all of these anti-patterns systematically.

---

## File Structure

```
order-booking-system/
├── k8s/
│   ├── v0-namespace.yaml
│   ├── v0-configmap.yaml
│   ├── v0-secret.yaml
│   ├── v0-postgres.yaml
│   ├── v0-kafka.yaml
│   ├── v0-order-service.yaml
│   ├── v0-inventory-service.yaml
│   ├── v0-payment-service.yaml
│   └── v0-notification-service.yaml
├── scripts/
│   ├── create-topics.sh (existing)
│   └── v0-deploy.sh (new)
├── src/
│   └── services/
│       ├── order-service/index.ts (UPDATED - added health/ready)
│       ├── inventory-service/index.ts (UPDATED - added health/ready + Express)
│       ├── payment-service/index.ts (UPDATED - added health/ready + Express)
│       └── notification-service/index.ts (UPDATED - added health/ready + Express)
├── V0_SETUP_SUMMARY.md (this file)
└── V0_DEPLOYMENT_GUIDE.md (detailed walkthrough)
```

---

## What's Next (V1)

V1 will add, in order:

1. **Code prep**: Graceful shutdown handlers (SIGTERM), better health checks
2. **Helm charts**: Templated deployments instead of raw YAML
3. **Resource management**: `requests`, `limits`, HPA
4. **Probes**: liveness, readiness, startup
5. **Persistence**: PVC for Postgres data
6. **Networking**: Ingress (replace NodePort), TLS
7. **Security**: Sealed Secrets, non-root users, network policies
8. **Observability**: Prometheus metrics, structured logging
9. **CI/CD**: GitHub Actions pipeline → Trivy scanning → ArgoCD GitOps
10. **Auto-scaling**: HPA on CPU/memory, optionally KEDA on Kafka consumer lag

Each fix will be paired with an explanation of why v0's approach failed.

---

Good luck with V0! Once you see it crash, V1's improvements will feel like magic. 🚀
