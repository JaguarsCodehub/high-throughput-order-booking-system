# V0 Deployment Guide: Intentionally Broken Kubernetes

This guide will walk you through deploying the order-booking-system to Kubernetes **the wrong way** (v0), demonstrating common anti-patterns, then intentionally crashing it to show why these patterns fail.

---

## Prerequisites

SSH into your `t3.small` EC2 instance and run the setup from Part 1 of the setup guide.

Verify everything is installed:
```bash
kind --version
kubectl version --client
helm version
k6 version
docker --version
```

---

## Step-by-step Deployment

### 1. Clone/navigate to your repo
```bash
cd ~/order-booking-system
```

### 2. Build the project
```bash
npm install
npm run build
```

### 3. Create the KIND cluster
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
```

### 4. Install ingress-nginx (for later use)
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s
```

### 5. Deploy v0 (run the script)
```bash
bash scripts/v0-deploy.sh
```

This will:
- Build all 4 service images
- Load them into KIND
- Create namespace `obs-v0`
- Deploy Postgres, Kafka, and all 4 services (bare, no limits/probes)
- Initialize the database

---

## Verify Deployment

```bash
# Check pod status
kubectl get pods -n obs-v0

# Check services
kubectl get svc -n obs-v0

# View logs
kubectl logs -n obs-v0 -l app=order-service -f
```

---

## Test Basic Functionality (Before Crash)

### Health check
```bash
curl http://localhost:30001/health
# Response: {"status":"alive","service":"order-service"}
```

### Create an order (manual)
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
```

### Check Kafka topic (in cluster)
```bash
kubectl exec -it -n obs-v0 $(kubectl get pod -n obs-v0 -l app=kafka -o jsonpath="{.items[0].metadata.name}") -- \
  kafka-console-consumer --bootstrap-server localhost:29092 --topic order.created --from-beginning --timeout-ms 1000
```

---

## Load Test (Intentional Crash)

### Option 1: Using k6
```bash
cat > load-test.js << 'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 VUs
    { duration: '1m', target: 50 },    // Ramp up to 50 VUs
    { duration: '30s', target: 100 },  // Ramp up to 100 VUs
    { duration: '1m', target: 100 },   // Stay at 100 VUs
    { duration: '30s', target: 0 },    // Ramp down
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

k6 run load-test.js
```

### Option 2: Using Apache Bench
```bash
# Simple high concurrency test
ab -n 10000 -c 100 -p payload.json -T application/json http://localhost:30001/api/orders
```

Where `payload.json` is:
```json
{"userId":1,"items":[{"productId":1,"quantity":1,"unitPrice":100}],"totalAmount":100}
```

### Option 3: Using autocannon (npm)
```bash
npm install -g autocannon

autocannon -c 100 -d 60 -n 100000 \
  --method POST \
  --header "Content-Type:application/json" \
  --body '{"userId":1,"items":[{"productId":1,"quantity":1,"unitPrice":100}],"totalAmount":100}' \
  http://localhost:30001/api/orders
```

---

## Observe the Crash (This is the Goal of V0!)

### Monitor pod status in real-time
```bash
# In one terminal
watch -n 1 'kubectl get pods -n obs-v0 -o wide'

# You should see:
# - order-service pod: CrashLoopBackOff or OOMKilled
# - Other pods may also fail due to cascading issues
```

### Check resource usage
```bash
kubectl top nodes
kubectl top pods -n obs-v0
```

### View pod events/logs
```bash
# Get events
kubectl get events -n obs-v0 --sort-by='.lastTimestamp' | tail -20

# Check if OOMKilled
kubectl describe pod -n obs-v0 -l app=order-service

# View logs
kubectl logs -n obs-v0 -l app=order-service --tail=50
```

### On the EC2 host, check system OOM killer
```bash
# SSH into the EC2 and run:
dmesg | tail -50  # See OOM Killer messages
free -h            # Check memory usage
```

---

## Expected Failures in V0

### What will break:
1. **No resource limits** → Pod(s) consume all available memory
2. **No liveness probes** → Dead pods stay scheduled, no restart
3. **No startup probes** → Services don't wait for dependencies (Kafka/DB)
4. **`imagePullPolicy: Always`** → Every restart pulls image, wastes time
5. **No PVC** → If Postgres restarts, data is lost
6. **No graceful shutdown** → In-flight requests drop
7. **Single replica** → One pod dies = downtime
8. **emptyDir volumes** → Ephemeral data storage

### Symptoms you'll see:
- `OOMKilled` status on order-service pod
- `CrashLoopBackOff` status on inventory/payment services (can't connect to DB/Kafka)
- Consumer lag increasing (Kafka events not processed)
- kubectl describe showing `Backoff restarting failed container`

---

## Capture Evidence (For Your Portfolio/Blog Post)

### Screenshots to take:
1. Successful health check before load test
2. Pod status during load test (CrashLoopBackOff, OOMKilled)
3. `kubectl top pods` showing memory spike
4. `kubectl describe pod` showing OOMKilled reason
5. `dmesg` output from EC2 showing OOM Killer

### Logs to save:
```bash
# Save pod events
kubectl get events -n obs-v0 > v0-events.log

# Save pod descriptions
kubectl describe pods -n obs-v0 > v0-pod-descriptions.log

# Save logs
kubectl logs -n obs-v0 -l app=order-service > v0-order-logs.log
```

---

## Clean Up (Before V1)

```bash
# Delete the v0 namespace (all resources deleted with it)
kubectl delete namespace obs-v0

# Delete the KIND cluster
kind delete cluster --name order-booking

# Remove Docker images
docker rmi order-service:latest inventory-service:latest payment-service:latest notification-service:latest
```

---

## Key Takeaways for V0

| Anti-Pattern | Why it fails | Fix in V1 |
|---|---|---|
| No `limits` | Pod eats all memory → OOMKilled | `resources.limits` and `requests` |
| No `probes` | Kubelet can't tell if pod is healthy | Add liveness + readiness probes |
| `imagePullPolicy: Always` | Slow startup, requires image always available | Pin specific image tag + `IfNotPresent` |
| No `PVC` | Data lost on pod restart | Add `PersistentVolume` and `PersistentVolumeClaim` |
| `NodePort` | Exposes every pod on every port, ugly | Add `Ingress` with routing rules |
| Plaintext secrets | Visible in git/describe | `Sealed Secrets` or `SOPS` |
| Single replica | Single point of failure | `replicas: 3` or `HPA` |
| No `securityContext` | Running as root (dangerous) | `runAsUser: non-root` |
| Manual `kubectl apply` | Drift over time | CI/CD pipeline (GitHub Actions + ArgoCD) |

---

## Next: V1 Production Deployment

Once you've captured the crash evidence and understand what went wrong, move to V1 which will fix all of these in a logical sequence.

See: `V1_DEPLOYMENT_GUIDE.md` (coming next)
