# V0 Setup & Deployment: Executive Summary

## What You Have Now

You have a **complete, step-by-step plan** to deploy your order-booking-system to Kubernetes on a t3.small EC2 instance, intentionally make it crash, and document the failure.

---

## Files Created

### 📋 Documentation (Read These First)
1. **`V0_IMPLEMENTATION_ROADMAP.md`** ← **START HERE** 
   - Complete 11-phase execution plan
   - Exact commands for each phase
   - Timeline for each step
   - Expected outputs
   - Phase 1-3: System setup (30 mins)
   - Phase 4-7: Deployment (45 mins)
   - Phase 8-11: Testing & cleanup (20 mins)

2. **`V0_SETUP_SUMMARY.md`**
   - Overview of code changes
   - K8s manifest anti-patterns explained
   - Expected failure modes in detail
   - Key metrics to capture for blog post

3. **`V0_DEPLOYMENT_GUIDE.md`**
   - In-depth walkthrough
   - Detailed testing procedures
   - Load testing options
   - Evidence capture instructions

### 🚀 Deployment Tools
4. **`V0_QUICK_START.sh`**
   - Automated setup script (one big bash script)
   - Installs all tools + creates cluster + deploys v0
   - Run once to get everything ready (takes ~1 hour)

5. **`scripts/v0-deploy.sh`**
   - In your repo, run anytime to deploy/redeploy
   - Builds Docker images
   - Loads into KIND
   - Deploys all manifests

### 📊 Load Testing
6. **`load-test.js`**
   - k6 load testing script
   - Ramps up from 10 → 100 concurrent users
   - Tracks custom metrics
   - Will cause the system to crash (goal of v0)

### 🔧 Kubernetes Manifests (in `k8s/` directory)
All intentionally broken for v0 demo:
- `v0-namespace.yaml` — Create isolated namespace
- `v0-configmap.yaml` — Configuration (DB host, Kafka broker)
- `v0-secret.yaml` — Secrets (plaintext password ❌)
- `v0-postgres.yaml` — No limits, no probes, no PVC
- `v0-kafka.yaml` — No limits, no probes (KRaft mode, no ZooKeeper)
- `v0-order-service.yaml` — API service with NodePort
- `v0-inventory-service.yaml` — Worker service
- `v0-payment-service.yaml` — Worker service
- `v0-notification-service.yaml` — Worker service

### 💻 Code Changes (In Your Services)
- Added `/health` endpoint (liveness check)
- Added `/ready` endpoint (readiness check with dependency verification)
- Added Express servers to worker services (inventory, payment, notification)

These changes are **minimal** and necessary so K8s has health endpoints to check, but probes aren't configured in v0 yet.

---

## The V0 Plan: 3-Step Execution

### Step 1: Setup (30 mins)
Run the quick start script to install Docker, kind, kubectl, helm, k6 and create KIND cluster:
```bash
bash V0_QUICK_START.sh
```

**This installs:**
- Docker (container runtime)
- kind (Kubernetes-in-Docker)
- kubectl (K8s CLI)
- helm (K8s package manager)
- k6 (load testing tool)
- ingress-nginx (will use in v1)

### Step 2: Deploy V0 (5 mins)
Run the deployment script:
```bash
bash scripts/v0-deploy.sh
```

**This:**
- Builds 4 microservice Docker images
- Loads them into KIND cluster
- Deploys Postgres + Kafka + 4 services (bare, no limits/probes)
- Initializes database
- Exposes services via NodePort (order-service at `:30001`)

### Step 3: Crash It Intentionally (10 mins)
Run the load test to overwhelm the system:
```bash
# Terminal 1: Monitor pods
watch -n 1 'kubectl get pods -n obs-v0'

# Terminal 2: Load test
k6 run load-test.js
```

**What happens:**
- Load test ramps up from 10 → 100 concurrent users
- Pods have no memory limits, so they consume all available RAM
- After 2-3 mins: `OOMKilled` status (out of memory)
- Pods restart, crash again immediately → `CrashLoopBackOff`
- Your system is now demonstrably broken

**Capture evidence:**
```bash
kubectl describe pods -n obs-v0 > crash-evidence.log
kubectl get events -n obs-v0 --sort-by='.lastTimestamp' > crash-events.log
dmesg | tail -50 > oommkiller.log
```

---

## Why This Matters for Your Portfolio

### The Story V0 Tells:
**"I built a Kubernetes deployment the wrong way on purpose to show exactly why each best practice matters."**

This is a **much stronger** portfolio piece than just showing working code because:

1. **Demonstrates understanding** — You know what breaks and why
2. **Teaches others** — A blog post/X thread: "Here's what I got wrong, here's what I fixed"
3. **Before/after proof** — Screenshots of CrashLoopBackOff → v1's clean scaling
4. **Systems thinking** — Shows how resource limits, probes, PVCs, etc. all connect

### The Blog Post Angle:
**"I deployed Kubernetes wrong on purpose. Here's what broke and how v1 fixes it."**

Chapters could be:
- Chapter 1: The v0 anti-patterns (this is the setup)
- Chapter 2: Load testing the broken system (watch it crash)
- Chapter 3: Why each failure happened (resource exhaustion, no probes, etc.)
- Chapter 4: V1's fixes one by one
- Chapter 5: Load testing v1 (watch it scale gracefully)
- Conclusion: Real Kubernetes production deployment

---

## Effort Breakdown

| Phase | Time | Difficulty | Effort |
|-------|------|-----------|--------|
| Read roadmap | 10 mins | Easy | 🟢 |
| System setup | 15 mins | Easy | 🟢 (mostly waiting) |
| KIND cluster | 5 mins | Easy | 🟢 |
| Deploy v0 | 5 mins | Easy | 🟢 (run one script) |
| Load test | 10 mins | Medium | 🟡 (need to understand output) |
| Capture evidence | 5 mins | Easy | 🟢 |
| **Total** | **~50 mins** | **Easy** | **Mostly copy/paste** |

---

## Expected Results

### Before Load Test ✅
```bash
$ kubectl get pods -n obs-v0
NAME                                   READY   STATUS    RESTARTS   AGE
order-service-abc123-def456           1/1     Running   0          2m
inventory-service-xyz789-uvw012       1/1     Running   0          2m
payment-service-pqr345-stu678         1/1     Running   0          2m
notification-service-lmn901-opq234    1/1     Running   0          2m
postgres-jkl567-mno890                1/1     Running   0          3m
kafka-ghi234-jkl567                   1/1     Running   0          3m
```

### After Load Test ❌
```bash
$ kubectl get pods -n obs-v0
NAME                                   READY   STATUS           RESTARTS   AGE
order-service-abc123-def456           0/1     OOMKilled        5          4m
inventory-service-xyz789-uvw012       0/1     CrashLoopBackOff 7          4m
payment-service-pqr345-stu678         0/1     CrashLoopBackOff 4          4m
notification-service-lmn901-opq234    0/1     CrashLoopBackOff 3          4m
postgres-jkl567-mno890                1/1     Running          0          5m
kafka-ghi234-jkl567                   1/1     Running          0          5m
```

**Key evidence:**
- `OOMKilled` — Pod ran out of memory (no limits set)
- `CrashLoopBackOff` — Pod restarts immediately, then crashes again
- Database/Kafka still running — They're okay, but services can't connect

---

## What NOT to Do

❌ Don't skip the setup — each tool is needed
❌ Don't skip reading the roadmap — it has exact commands
❌ Don't load test with small numbers (needs 100+ concurrent to trigger)
❌ Don't delete your cluster immediately — capture evidence first
❌ Don't change the manifests yet — they need to be broken for v0

---

## What to Do Next After V0 Crashes

1. **Capture all evidence** (see "Capture Evidence" section)
2. **Take screenshots** of pod status, resource usage
3. **Save logs** to git or local files
4. **Write a post/thread** documenting what went wrong
5. **Clean up** the crashed v0 deployment
6. **Start V1** with all the fixes (coming next)

---

## V0 vs V1 Comparison

| Aspect | V0 | V1 |
|--------|----|----|
| Resource limits | ❌ None | ✅ Configured, sized from v0 data |
| Liveness probe | ❌ None | ✅ `livenessProbe` |
| Readiness probe | ❌ None | ✅ `readinessProbe` |
| Startup probe | ❌ None | ✅ `startupProbe` (for Kafka/DB) |
| PersistentVolume | ❌ Data lost | ✅ PVC for Postgres |
| Secrets | ❌ Plaintext in git | ✅ `Sealed Secrets` |
| Ingress | ❌ NodePort `:30001` | ✅ Ingress with host routing |
| Replicas | ❌ Single pod | ✅ 3+ replicas with HPA |
| Rolling update | ❌ None | ✅ Configured with maxSurge/maxUnavailable |
| CI/CD | ❌ Manual kubectl | ✅ GitHub Actions + Trivy + ArgoCD |
| Security context | ❌ Running as root | ✅ `runAsUser: non-root` |
| Image tag | ❌ `:latest` | ✅ Pinned `v1.0.0` |
| Graceful shutdown | ❌ None | ✅ SIGTERM handler + terminationGracePeriod |
| Observability | ❌ Logs only | ✅ Prometheus metrics + structured logs |
| HPA | ❌ None | ✅ CPU + memory based scaling |
| Result | 💥 **Crashes** | ✅ **Scales gracefully** |

---

## Success Criteria for V0

You'll know v0 is successful when:

✅ System deploys cleanly  
✅ Health check passes: `curl http://localhost:30001/health`  
✅ You can create orders manually via API  
✅ Load test runs and pods start failing  
✅ You see `OOMKilled` or `CrashLoopBackOff` in pod status  
✅ You capture evidence (logs, screenshots, pod descriptions)  
✅ You understand *why* each component failed  

Then you move to V1 and fix them all systematically.

---

## Files You Have

All files have been created in your repo or in `/mnt/user-data/outputs/`:

**In your repo (`~/order-booking-system/`):**
- `k8s/v0-*.yaml` — All 9 K8s manifests
- `scripts/v0-deploy.sh` — Deployment script
- `load-test.js` — Load testing script
- `V0_SETUP_SUMMARY.md`
- `V0_DEPLOYMENT_GUIDE.md`
- `V0_IMPLEMENTATION_ROADMAP.md`
- `V0_QUICK_START.sh`
- Updated service files with `/health` and `/ready` endpoints

**In outputs folder (also saved here for reference):**
- All documentation files above
- Ready for download/sharing

---

## Next: Start Phase 1

```bash
# SSH into your EC2 instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Read the roadmap first
cat ~/order-booking-system/V0_IMPLEMENTATION_ROADMAP.md

# Then run Phase 1 setup
# (Follow commands from the roadmap)
```

Or, one-shot automated setup:
```bash
cd ~/order-booking-system
bash V0_QUICK_START.sh
```

**Total time from "let's start" to "system is crashing": ~1 hour** ⏱️

---

**You're ready. The plan is complete. Now execute.** 🚀

Good luck! When v0 crashes, you'll have earned the right to build v1 properly. ✨
