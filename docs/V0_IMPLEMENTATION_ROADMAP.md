# V0 Implementation Roadmap

## Overview

This document maps out **exactly what you need to do** to deploy v0 on your t3.small EC2 instance and intentionally crash it.

---

## Phase 1: EC2 Instance Preparation (30 mins)

### What: Initial system setup on your EC2 instance

**Before you start:**
- SSH into your t3.small instance
- You have ~2GB RAM available
- Network access to download ~1GB+ of Docker images

**Commands:**
```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install Docker
sudo apt install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
newgrp docker

# 3. Install kind (Kubernetes-in-Docker)
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64
chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind

# 4. Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/kubectl

# 5. Install helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 6. Install k6 (for load testing)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install -y k6

# 7. Verify all installations
kind --version      # Should be v0.23.0+
kubectl version     # Should be v1.28+
helm version        # Should be v3.x+
k6 version          # Should be v0.47.0+
docker --version    # Should be Docker 20.x+
```

**Expected output:**
```
kind version 0.23.0
Client Version: v1.28.X
version.BuildInfo{Version:"v3.X.X", ...}
v0.47.0
Docker version 20.X.X, build XXXX
```

**Time: ~10-15 mins** (mostly waiting for downloads)

---

## Phase 2: KIND Cluster Creation (10 mins)

### What: Create a Kubernetes cluster running inside Docker

**Commands:**
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

# Create the cluster (takes ~2 mins)
kind create cluster --config ~/kind-setup/kind-config.yaml

# Verify it's running
kubectl cluster-info
kubectl get nodes
```

**Expected output:**
```
Kubernetes control plane is running at https://127.0.0.1:XXXXX
CoreDNS is running at ...
NAME                         STATUS   ROLES           AGE   VERSION
order-booking-control-plane  Ready    control-plane   2m    v1.28.0
```

**Port mapping explanation:**
- Port 80/443: For Ingress (we'll use it in v1)
- Port 9092: For Kafka external access
- `/data` mount: For persistent storage (unused in v0, will use in v1)

**Time: ~5 mins**

---

## Phase 3: Install Ingress Controller (5 mins)

### What: Set up ingress-nginx so we can route traffic to services

**Commands:**
```bash
# Install ingress-nginx
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/kind/deploy.yaml

# Wait for it to be ready (takes ~30-60s)
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=120s

# Verify
kubectl get pods -n ingress-nginx
```

**Expected output:**
```
NAMESPACE       NAME                                        READY   STATUS    RESTARTS   AGE
ingress-nginx   ingress-nginx-controller-XXXXXX-XXXXX      1/1     Running   0          45s
```

**Time: ~2 mins** (mostly waiting)

---

## Phase 4: Clone Repo & Build Project (15 mins)

### What: Get your code ready and compile TypeScript

**Commands:**
```bash
# If not already there, clone your repo
cd ~
git clone <your-repo-url> order-booking-system
cd order-booking-system

# Install dependencies
npm install

# Build TypeScript → JavaScript
npm run build

# Verify dist/ was created
ls -la dist/services/order-service/index.js
```

**What this does:**
- Downloads all npm dependencies (~500MB)
- Compiles TypeScript files to JavaScript
- Creates the `dist/` folder that Docker will copy

**Time: ~10-15 mins** (npm install is slow)

---

## Phase 5: Code Changes (Already Done, But Review)

### What: Add health/ready endpoints to services

**Files modified** (already updated in the codebase):
- `src/services/order-service/index.ts` → Added `/health` and `/ready`
- `src/services/inventory-service/index.ts` → Added `/health`, `/ready`, Express server
- `src/services/payment-service/index.ts` → Added `/health`, `/ready`, Express server
- `src/services/notification-service/index.ts` → Added `/health`, `/ready`, Express server

**Why:**
- Kubernetes probes need endpoints to check pod health
- These endpoints check if Kafka/Postgres connections are established
- Without these, K8s has no way to know if your pods are healthy

**Changes included:**
```typescript
// All services now have:
app.get('/health', (req, res) => res.status(200).json({ status: 'alive' }));
app.get('/ready', async (req, res) => {
  // Check if Kafka/Postgres are connected
  // Return 503 if not ready, 200 if ready
});
```

---

## Phase 6: Kubernetes Manifests (Already Created)

### What: YAML files that describe how to deploy each component

**Files created** in `k8s/`:

| File | Component | Anti-patterns |
|------|-----------|---|
| `v0-namespace.yaml` | Create `obs-v0` namespace | None (good) |
| `v0-configmap.yaml` | Configuration (DB host, Kafka broker, ports) | None (good) |
| `v0-secret.yaml` | Secrets (DB password) | **Plaintext in git** ❌ |
| `v0-postgres.yaml` | PostgreSQL deployment | No limits, no probes, no PVC |
| `v0-kafka.yaml` | Kafka (KRaft mode) | No limits, no probes |
| `v0-order-service.yaml` | Order API | No limits, no probes, `latest` tag, root user |
| `v0-inventory-service.yaml` | Inventory worker | No limits, no probes, `latest` tag |
| `v0-payment-service.yaml` | Payment worker | No limits, no probes, `latest` tag |
| `v0-notification-service.yaml` | Notification worker | No limits, no probes, `latest` tag |

**Key anti-patterns in these manifests:**
1. ❌ No `resources.limits` → Pods can consume unlimited memory
2. ❌ No `livenessProbe` → Kubelet won't restart dead pods
3. ❌ No `readinessProbe` → Traffic routes to unready pods
4. ❌ No `startupProbe` → Services may not be ready before traffic hits them
5. ❌ `imagePullPolicy: Always` with `:latest` tag → Slow, unreliable updates
6. ❌ No `PersistentVolume` → Data lost on pod restart (Postgres)
7. ❌ `NodePort` instead of `Ingress` → Exposes every node:port publicly
8. ❌ Single `replicas: 1` → No redundancy
9. ❌ `securityContext.runAsUser: 0` → Running as root ☠️
10. ❌ Plaintext DB password in git → 🔓 Security hole

**These are intentional for v0 demo!**

---

## Phase 7: Deployment Script (Ready to Run)

### What: Automated script that builds, loads, and deploys everything

**File:** `scripts/v0-deploy.sh`

**What it does:**
1. Builds 4 Docker images locally (order, inventory, payment, notification)
2. Loads them into KIND cluster
3. Creates `obs-v0` namespace
4. Deploys ConfigMap, Secret, Postgres, Kafka, and 4 services
5. Initializes the database schema
6. Reports service endpoints

**Commands:**
```bash
cd ~/order-booking-system

# Run the one-shot deployment
bash scripts/v0-deploy.sh
```

**Expected output:**
```
════════════════════════════════════════════════════════════
  V0 DEPLOYMENT: Intentionally Broken Kubernetes Deploy
════════════════════════════════════════════════════════════

[STEP 1] Building Docker images...
✓ order-service image built
✓ inventory-service image built
✓ payment-service image built
✓ notification-service image built

[STEP 2] Loading images into KIND cluster...
✓ All images loaded to KIND

[STEP 3] Deploying to Kubernetes...
✓ Namespace created
✓ ConfigMap and Secrets deployed
✓ Postgres deployed
⏳ Waiting for Postgres to be ready...
✓ Kafka deployed
⏳ Waiting for Kafka to be ready...
✓ All services deployed

[STEP 4] Initializing database...
✓ Database initialized

[STEP 5] Deployment Status:
────────────────────────────────────────────────────────────
NAME                                       READY   STATUS    RESTARTS   AGE
pod/order-service-XXXXXX-XXXXX            1/1     Running   0          30s
pod/inventory-service-XXXXXX-XXXXX        1/1     Running   0          25s
pod/payment-service-XXXXXX-XXXXX          1/1     Running   0          20s
pod/notification-service-XXXXXX-XXXXX     1/1     Running   0          15s
pod/postgres-XXXXXX-XXXXX                 1/1     Running   0          45s
pod/kafka-XXXXXX-XXXXX                    1/1     Running   0          40s

[READY] You can now test with:
  curl http://localhost:30001/health
  curl -X POST http://localhost:30001/api/orders ...
```

**Time: ~3-4 mins**

---

## Phase 8: Basic Testing (5 mins)

### What: Verify v0 is deployed and working before we crash it

**Commands:**
```bash
# 1. Check pod status
kubectl get pods -n obs-v0

# 2. Test health endpoint
curl http://localhost:30001/health
# Expected: {"status":"alive","service":"order-service"}

# 3. Create a test order
curl -X POST http://localhost:30001/api/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": 1,
    "items": [
      {"productId": 1, "quantity": 5, "unitPrice": 100}
    ],
    "totalAmount": 500
  }'
# Expected: {"message":"Order placed successfully","orderId":"uuid"}

# 4. Check logs
kubectl logs -n obs-v0 -l app=order-service -f
```

**If everything works:** ✅ You're ready to crash it!

**Time: ~5 mins**

---

## Phase 9: Load Testing (The Crash!) (10 mins)

### What: Deliberately overwhelm the system to trigger failures

**Two approaches:**

### Option A: k6 (Recommended)
```bash
cd ~/order-booking-system

# In Terminal 1: Monitor pods in real-time
watch -n 1 'kubectl get pods -n obs-v0 -o wide'

# In Terminal 2: Run the load test
k6 run load-test.js

# What to watch for:
# - order-service pod shows "CrashLoopBackOff" or "OOMKilled"
# - Memory usage spikes on the node
# - Errors increase in k6 output
```

### Option B: Apache Bench (Simple, Direct)
```bash
# In one terminal
watch -n 1 'kubectl get pods -n obs-v0'

# In another terminal
ab -n 100000 -c 500 -p payload.json -T application/json \
  http://localhost:30001/api/orders
```

Where `payload.json` is:
```json
{"userId":1,"items":[{"productId":1,"quantity":1,"unitPrice":100}],"totalAmount":100}
```

### What will happen:
1. **First 30s:** Requests succeed, pods are healthy
2. **Next 1-2 mins:** Memory usage climbs as pods buffer requests
3. **3-4 mins:** Pods hit memory limit, OOMKiller activates
4. **Result:** `OOMKilled` status, pod restarts, crashes again (CrashLoopBackOff)

**Expected failure indicators:**
```
NAME                          READY   STATUS           RESTARTS   AGE
order-service-XXXXXX-XXXXX   0/1     CrashLoopBackOff 5          2m
inventory-service-XXXXXX     0/1     CrashLoopBackOff 3          2m
payment-service-XXXXXX       0/1     OOMKilled        2          2m
```

**Time: ~5-10 mins** (depending on how fast you load test)

---

## Phase 10: Capture Evidence (5 mins)

### What: Document the failure for your blog post / portfolio

**Commands to run:**
```bash
# 1. Save pod descriptions (shows OOMKilled reason)
kubectl describe pods -n obs-v0 > ~/v0-crash-pod-descriptions.log

# 2. Save events (shows what K8s did)
kubectl get events -n obs-v0 --sort-by='.lastTimestamp' > ~/v0-crash-events.log

# 3. Save resource usage
kubectl top pods -n obs-v0 > ~/v0-crash-resources.log
kubectl top nodes >> ~/v0-crash-resources.log

# 4. Save pod status as JSON
kubectl get pods -n obs-v0 -o json > ~/v0-crash-pods.json

# 5. Check EC2 host's OOM killer (SSH to EC2)
dmesg | grep -i oomkiller | tail -20 > ~/v0-crash-oomkiller.log

# 6. Screenshot the watch terminal showing CrashLoopBackOff
# (Use Print Screen or screenshot tool)
```

**Files to keep:**
- `v0-crash-pod-descriptions.log` — Shows `OOMKilled` state
- `v0-crash-events.log` — Shows sequence of failures
- `v0-crash-resources.log` — Shows memory exhaustion
- `v0-crash-pods.json` — Full pod status
- `v0-crash-oomkiller.log` — System-level OOM evidence
- Screenshot of terminal

**These become evidence for your blog post:** "Here's what happens when you deploy Kubernetes without resource limits" 📸

**Time: ~5 mins**

---

## Phase 11: Clean Up (Before V1)

### What: Delete v0 so we can start fresh with v1

**Commands:**
```bash
# Delete the v0 namespace (deletes all resources in it)
kubectl delete namespace obs-v0

# Wait for deletion
kubectl get namespace obs-v0 --watch  # Ctrl+C when gone

# Delete the KIND cluster
kind delete cluster --name order-booking

# Remove Docker images (optional, saves ~1GB)
docker rmi order-service:latest inventory-service:latest \
  payment-service:latest notification-service:latest
```

**Time: ~2 mins**

---

## Summary Timeline

| Phase | What | Time | Cumulative |
|-------|------|------|-----------|
| 1 | EC2 setup | 15m | 15m |
| 2 | KIND cluster | 5m | 20m |
| 3 | Ingress | 5m | 25m |
| 4 | Build project | 15m | 40m |
| 5 | Code changes | - | 40m |
| 6 | Manifests | - | 40m |
| 7 | Deploy | 5m | 45m |
| 8 | Basic test | 5m | 50m |
| 9 | Load test crash | 10m | 60m |
| 10 | Capture evidence | 5m | 65m |
| 11 | Clean up | 2m | 67m |

**Total: ~1 hour 10 minutes start to finish**

---

## Files Checklist

Before you start, ensure these files exist in your repo:

```
order-booking-system/
├── k8s/
│   ├── v0-namespace.yaml ✓
│   ├── v0-configmap.yaml ✓
│   ├── v0-secret.yaml ✓
│   ├── v0-postgres.yaml ✓
│   ├── v0-kafka.yaml ✓
│   ├── v0-order-service.yaml ✓
│   ├── v0-inventory-service.yaml ✓
│   ├── v0-payment-service.yaml ✓
│   └── v0-notification-service.yaml ✓
├── scripts/
│   └── v0-deploy.sh ✓
├── load-test.js ✓
├── V0_SETUP_SUMMARY.md ✓
├── V0_DEPLOYMENT_GUIDE.md ✓
├── V0_QUICK_START.sh ✓
└── src/services/
    ├── order-service/index.ts (updated) ✓
    ├── inventory-service/index.ts (updated) ✓
    ├── payment-service/index.ts (updated) ✓
    └── notification-service/index.ts (updated) ✓
```

All files are already created and in your repo!

---

## Next: V1 Production Deployment

Once you've crashed v0 and captured the evidence, V1 will:

1. Add resource `limits` and `requests` (fix OOMKilled)
2. Add liveness/readiness/startup probes (fix CrashLoopBackOff)
3. Add PVC for Postgres (fix data loss)
4. Add Ingress (replace NodePort)
5. Add HPA (horizontal scaling)
6. Add Helm charts (templated deployments)
7. Add CI/CD pipeline (GitHub Actions)
8. Add Sealed Secrets (secure password management)
9. Add observability (Prometheus, logs)
10. Add graceful shutdown handlers (SIGTERM)

Each fix will be mapped to the specific v0 failure it solves.

---

## Quick Reference Commands

```bash
# Watch pods during crash
watch -n 1 'kubectl get pods -n obs-v0 -o wide'

# View logs
kubectl logs -n obs-v0 -l app=order-service -f

# Check resource usage
kubectl top pods -n obs-v0

# Get events
kubectl get events -n obs-v0 --sort-by='.lastTimestamp'

# Describe a pod (shows OOMKilled reason)
kubectl describe pod -n obs-v0 -l app=order-service

# See all resources in namespace
kubectl get all -n obs-v0

# Delete namespace
kubectl delete namespace obs-v0

# Delete KIND cluster
kind delete cluster --name order-booking

# SSH to EC2 and check OOM
dmesg | grep oomkiller
```

---

**You're ready! Start with Phase 1.** 🚀

Good luck crashing this on purpose! The v1 fixes will feel like magic. ✨
