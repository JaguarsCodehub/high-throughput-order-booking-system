# DevOps Engineering Report
## High-Throughput Order Booking System

> **Date:** July 24, 2026  
> **Stack:** Node.js · TypeScript · Docker · Kubernetes (KIND) · Helm · Ansible · GitHub Actions · Trivy · ArgoCD  
> **Repository:** [JaguarsCodehub/high-throughput-order-booking-system](https://github.com/JaguarsCodehub/high-throughput-order-booking-system)

---

## Table of Contents
1. [What We Built — The Big Picture](#1-what-we-built--the-big-picture)
2. [Phase 1: Docker & Multi-Stage Builds](#2-phase-1-docker--multi-stage-builds)
3. [Phase 2: Kubernetes & KIND Cluster](#3-phase-2-kubernetes--kind-cluster)
4. [Phase 3: Helm — Packaging Kubernetes](#4-phase-3-helm--packaging-kubernetes)
5. [Phase 4: Ansible — Automating Everything](#5-phase-4-ansible--automating-everything)
6. [Phase 5: CI Pipeline — GitHub Actions & Trivy](#6-phase-5-ci-pipeline--github-actions--trivy)
7. [Phase 6: ArgoCD — GitOps & Continuous Delivery](#7-phase-6-argocd--gitops--continuous-delivery)
8. [Live Demos & Proofs](#8-live-demos--proofs)
9. [Improvements & What's Next](#9-improvements--whats-next)

---

## 1. What We Built — The Big Picture

We transformed a microservices application into a **production-grade, self-healing, GitOps-driven platform**. Every phase builds on top of the last:

```
Developer pushes code to GitHub
         │
         ▼
┌─────────────────────────┐
│   GitHub Actions (CI)   │  ← TypeScript build check
│   .github/workflows/    │  ← Helm lint validation
│   ci-cd.yaml            │  ← Trivy security scan
└────────────┬────────────┘
             │ (Pipeline passes)
             ▼
┌─────────────────────────┐
│   Git (Source of Truth) │  ← values.yaml, Chart.yaml, templates/
│   helm/ directory       │
└────────────┬────────────┘
             │ (ArgoCD polls every 3 min)
             ▼
┌─────────────────────────┐
│   ArgoCD (CD)           │  ← Detects drift / new commit
│   argocd/application.yaml│ ← Applies changes automatically
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Kubernetes (KIND)     │  ← Zero-downtime rolling update
│   Namespace: obs-v0     │  ← Self-heals if pods are deleted
└─────────────────────────┘
```

---

## 2. Phase 1: Docker & Multi-Stage Builds

### What We Built
A single, shared **multi-stage Dockerfile** that can build any of the 4 microservices using a `SERVICE_NAME` build argument.

### Key Concepts Learned

- **Multi-stage builds**: The `builder` stage installs all dev dependencies and compiles TypeScript. The final `production` stage only copies the compiled `dist/` folder and `node_modules` — keeping the image lean and secure.
- **Build Arguments (`ARG`)**: A single `Dockerfile` serves all 4 services by accepting `--build-arg SERVICE_NAME=order-service`. This avoids maintaining 4 separate Dockerfiles.
- **Non-root user**: The container runs as a non-root user for security hardening.
- **Alpine base image**: Using `node:20-alpine` instead of the full Debian image reduces image size from ~1GB to ~150MB and dramatically shrinks the attack surface.

```dockerfile
# Build stage: compiles TypeScript
FROM node:20-alpine AS builder
ARG SERVICE_NAME
WORKDIR /app
COPY src/services/${SERVICE_NAME} .
RUN npm ci && npm run build

# Production stage: lean, secure final image
FROM node:20-alpine AS production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]
```

---

## 3. Phase 2: Kubernetes & KIND Cluster

### What We Built
A local Kubernetes cluster running inside Docker using **KIND (Kubernetes IN Docker)**, with raw YAML manifests for initial testing before migrating to Helm.

### Key Kubernetes Objects

| Object | What It Does |
|---|---|
| **Pod** | The smallest deployable unit. Wraps one or more Docker containers. |
| **Deployment** | Manages Pods. Handles rolling updates, scaling, and restarts. |
| **Service** | Gives a stable internal IP/DNS name to a set of pods. |
| **ConfigMap** | Stores non-sensitive configuration (env vars) as key-value pairs. |
| **Secret** | Stores sensitive data (API keys, passwords) as base64-encoded values. |
| **Ingress** | The single entry point for all external HTTP traffic, routing by path to different services. |
| **StatefulSet** | Used for Kafka & Zookeeper — each pod gets a stable identity and its own persistent disk. |
| **HPA** | Horizontal Pod Autoscaler — automatically scales pod count based on CPU load. |

### The Ingress Routing Architecture

```
External Traffic → NGINX Ingress Controller
                          │
                          ├── /api/orders        → order-service:3001
                          ├── /api/inventory     → inventory-service:3002
                          ├── /api/payments      → payment-service:3003
                          └── /api/notifications → notification-service:3004
```

### Helm Rollback
We also covered `helm rollback`. Helm stores a full snapshot of every revision. Rolling back reverts **everything** — deployments, configmaps, secrets, and even recreates deleted Ingress resources.

---

## 4. Phase 3: Helm — Packaging Kubernetes

### What We Built
Migrated all raw Kubernetes YAML manifests into a single **Helm Chart** that deploys all 4 microservices, Kafka, Zookeeper, Ingress, and HPAs with one command.

### Chart Structure

```
helm/order-booking-system/
├── Chart.yaml                 # Chart metadata (name, version, appVersion)
├── values.yaml                # Single config file — all settings live here
└── templates/
    ├── deployment.yaml        # Deployment for all 4 microservices (uses loops)
    ├── service.yaml           # ClusterIP Service for each microservice
    ├── ingress.yaml           # NGINX Ingress with path-based routing
    ├── hpa.yaml               # Horizontal Pod Autoscaler per service
    ├── configmap.yaml         # Shared environment variables
    ├── secret.yaml            # Database URL and API keys
    └── kafka-statefulset.yaml # Kafka + Zookeeper StatefulSets + PVCs
```

### Key Concepts Learned

- **`values.yaml` as Single Source of Truth**: Every setting (image name, replica count, resource limits, HPA thresholds) is declared in `values.yaml`. Templates reference them with `{{ .Values.microservices.orderService.replicas }}`.
- **Template Loops**: `{{- range $key, $service := .Values.microservices }}` lets a single `deployment.yaml` generate 4 separate deployments automatically.
- **Helm Lifecycle Commands:**
  ```bash
  helm install obs ./helm/order-booking-system -n obs-v0 --create-namespace
  helm upgrade obs ./helm/order-booking-system -n obs-v0
  helm rollback obs 1 -n obs-v0
  helm history obs -n obs-v0
  helm uninstall obs -n obs-v0
  ```

---

## 5. Phase 4: Ansible — Automating Everything

### What We Built
Two fully automated Ansible playbooks that provision the entire system from scratch.

### `ansible/playbooks/deploy-app.yaml` — The Classic Playbook
1. Checks if KIND cluster exists, creates it if not (idempotent).
2. Builds all 4 Docker images.
3. Loads images into KIND so Kubernetes can pull them locally.
4. Installs NGINX Ingress Controller.
5. Deploys the Helm chart via `helm upgrade --install`.
6. Waits for Kafka and order-service to be healthy.
7. Displays cluster status.
8. Installs ArgoCD and applies the Application manifest.

### `ansible/playbooks/deploy-gitops.yaml` — The Pure GitOps Playbook
A cleaner version where Ansible only handles infrastructure. ArgoCD handles **all** application deployments:
1. Provisions KIND cluster.
2. Builds and loads Docker images.
3. Installs Ingress Controller.
4. Installs ArgoCD and applies `argocd/application.yaml`.
5. ArgoCD takes over — no manual `helm install` step.

### Key Concepts Learned

- **Idempotency**: Every Ansible task can be re-run safely. `ignore_errors: yes` is used for resources that already exist.
- **`register` + `until`**: Tasks like waiting for Kafka use a retry loop — Ansible retries up to 3 times with a 10-second delay until the pod is Ready.
- **`group_vars/all.yaml`**: A shared variables file storing `project_dir`, `namespace`, and image names so they are never repeated across playbooks.

---

## 6. Phase 5: CI Pipeline — GitHub Actions & Trivy

### What We Built
A fully automated **Continuous Integration (CI)** pipeline triggered on every push to `main` and every Pull Request.

### File: `.github/workflows/ci-cd.yaml`

The pipeline runs **3 parallel jobs:**

```
Push to GitHub
     │
     ├──► [Job 1] build-and-test          (matrix: 4 services in parallel)
     │         └── npm ci → npm run build
     │
     ├──► [Job 2] helm-lint               (runs independently)
     │         └── helm lint helm/order-booking-system
     │
     └──► [Job 3] docker-build-and-scan   (waits for Job 1 to pass)
               └── docker build → Trivy vulnerability scan
```

### Key Concepts Learned

- **Matrix Strategy**: `strategy.matrix.service: [order-service, ...]` spins up 4 parallel runners — one per service — making the pipeline fast.
- **Job Dependencies (`needs`)**: The `docker-build-and-scan` job uses `needs: build-and-test`. Trivy only runs if TypeScript compilation passed first.
- **Trivy Security Scanner**: Aqua Security's open-source CVE scanner configured to:
  - Fail the build on `CRITICAL` and `HIGH` severity vulnerabilities.
  - Only scan OS-level packages (`vuln-type: os`).
  - Skip vulnerabilities with no available fix (`ignore-unfixed: true`).
- **Trivy Fix**: The initial scan failed because it tried to run `trivy image` directly. The fix was switching to the official `aquasecurity/trivy-action` GitHub Action which handles DB caching and setup automatically.

---

## 7. Phase 6: ArgoCD — GitOps & Continuous Delivery

### What We Built
Installed **ArgoCD** into the cluster and connected it to GitHub. ArgoCD now **owns all deployments** — no human ever needs to run `kubectl apply` or `helm upgrade` again.

### File: `argocd/application.yaml`

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: order-booking-system
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io  # Cleans up everything on delete
spec:
  source:
    repoURL: https://github.com/JaguarsCodehub/high-throughput-order-booking-system.git
    targetRevision: HEAD   # Always track the latest commit
    path: helm/order-booking-system

  destination:
    server: https://kubernetes.default.svc
    namespace: obs-v0

  syncPolicy:
    automated:
      prune: true     # Delete resources removed from Git
      selfHeal: true  # Revert any manual kubectl changes
    syncOptions:
      - CreateNamespace=true
```

### Key Concepts Learned

- **GitOps vs CI/CD**: GitHub Actions is **push-based** (runs code when you push). ArgoCD is **pull-based** (lives inside the cluster and continuously polls Git). They complement each other perfectly.
- **`selfHeal: true`**: If anyone runs `kubectl delete deployment order-service`, ArgoCD detects the drift within seconds and recreates it automatically. **Git always wins.**
- **`prune: true`**: If a service is removed from `values.yaml` and pushed to Git, ArgoCD automatically deletes the corresponding pods and services from the cluster.
- **3-Minute Polling Cycle**: ArgoCD polls GitHub every 3 minutes by default. In production, this is replaced with a **GitHub Webhook** for instant syncs.
- **Zero-Downtime Rolling Updates**: When a commit changes `values.yaml`, ArgoCD triggers a Kubernetes rolling update — the new pod is fully `1/1 Ready` **before** the old pod is terminated. No customer ever experiences a dropped request.

### How ArgoCD Works Internally (Polling Loop)

1. The `argocd-application-controller` pod wakes up every 3 minutes and runs `git fetch`.
2. It compares the latest commit hash on `main` with its cached hash.
3. If a new commit is found, it downloads the new files and runs `helm template` internally.
4. It compares the rendered YAML to what is live in the cluster (drift detection).
5. Because `syncPolicy: automated` is set, it immediately applies the diff via the Kubernetes API.

---

## 8. Live Demos & Proofs

### Cluster State After Full Setup
```
NAME                                    READY   STATUS
inventory-service-5b8466c685-qdqmf      1/1     Running   ✅
kafka-0                                 1/1     Running   ✅
notification-service-774dd7c869-j7f28   1/1     Running   ✅
order-service-fbcc5d49c-g2flr           1/1     Running   ✅
payment-service-6fb78db9bd-hvrjz        1/1     Running   ✅
zookeeper-0                             1/1     Running   ✅
```

### Demo 1: Self-Healing Test
```bash
kubectl delete deployment order-service -n obs-v0
```
**Result**: ArgoCD detected the missing deployment and automatically recreated the pod within seconds.

### Demo 2: GitOps Sync Test
Changed `orderService.resources.limits.memory` from `256Mi` → `257Mi` in `values.yaml`, committed, and pushed to GitHub.

**Rolling update observed live:**
```
order-service-fbcc5d49c-g2flr   0/1   Pending            ← New pod starting
order-service-fbcc5d49c-g2flr   0/1   ContainerCreating
order-service-fbcc5d49c-g2flr   1/1   Running            ← New pod healthy ✅
order-service-59c99cb78-sbpqs   1/1   Terminating        ← Old pod removed ✅
```

### Infrastructure Issue Solved: Swap Space
- **Problem**: The EC2 `t3.small` (2GB RAM) was fully exhausted with ArgoCD's 6+ pods added on top of Kafka, Zookeeper, and 4 microservices. `kubectl` commands were hanging.
- **Solution**: Enabled 4GB of Swap space using `fallocate`, `mkswap`, and `swapon`. This allows idle memory to be offloaded to disk, keeping the cluster stable.

---

## 9. Improvements & What's Next

### 🔧 GitHub Actions (CI)

| Improvement | Why |
|---|---|
| Add `npm test` with Jest | Currently only `npm run build` runs. Real unit tests and coverage thresholds will catch logic bugs, not just compilation errors. |
| Push images to ECR / GHCR | Images are currently built and scanned but never stored anywhere. Pushing to a registry completes the CI→CD loop so ArgoCD can reference real versioned image tags. |
| Trivy SARIF output | Change Trivy's format to `sarif` and upload via `codeql-action/upload-sarif`. Vulnerabilities then appear inline on Pull Requests in the GitHub Security tab. |
| Cache Docker layers | Add `cache-from` / `cache-to` using GitHub Actions cache. Can cut Docker build time by 60–80% on repeated runs. |
| Branch protection rules | Require all 3 CI jobs to pass before any PR can merge into `main`. |

### ⚙️ ArgoCD (CD)

| Improvement | Why |
|---|---|
| GitHub Webhook | Register your ArgoCD URL as a webhook in GitHub repo settings. Syncs become instant instead of waiting 3 minutes. |
| ArgoCD Image Updater | When CI pushes a new image tag to ECR, Image Updater automatically patches `values.yaml` in Git with the new tag — completing the full automated loop without any human involvement. |
| Slack / Email Notifications | Configure ArgoCD Notifications to alert your team when an app goes `Degraded` or `OutOfSync`. |
| Custom ArgoCD Project | Replace the `default` project with a scoped project that restricts which source repos and destination namespaces are allowed. Prevents accidental cross-namespace deployments. |
| SSO via GitHub OAuth | Replace the `admin` password with GitHub OAuth so team members log in with their GitHub accounts. |

### 📦 Helm Chart

| Improvement | Why |
|---|---|
| `values-dev.yaml` / `values-prod.yaml` | Separate per-environment values files. Pass them with `-f values-prod.yaml`. Prevents accidental production config changes from dev. |
| Helm Secrets plugin | Stop base64-encoding secrets in `values.yaml`. Use `helm-secrets` + AWS Secrets Manager or HashiCorp Vault to inject real secrets at deploy time. |
| Liveness & Readiness Probes | Add HTTP health check probes to all deployment templates so Kubernetes knows exactly when a container is alive vs. truly ready to receive traffic. |
| `NOTES.txt` template | Add `templates/NOTES.txt` to print helpful post-install instructions after every `helm install` / `helm upgrade`. |
| Bump `appVersion` in CI | Automatically update `Chart.yaml`'s `appVersion` in CI when a new image is published so Helm history reflects the real application version. |

### 🌐 Ingress

| Improvement | Why |
|---|---|
| TLS / HTTPS with cert-manager | Install `cert-manager` + a `ClusterIssuer` to automatically provision free Let's Encrypt SSL certificates. All traffic encrypted in transit. |
| Rate Limiting | Add `nginx.ingress.kubernetes.io/limit-rps` annotations to prevent DoS attacks on public endpoints. |
| JWT Auth at Ingress level | Use `nginx.ingress.kubernetes.io/auth-url` to enforce token validation before requests even reach your microservices. |
| Canary Deployments | Use NGINX canary annotations to route 5% of traffic to a new version and 95% to stable. Test in production safely. |

### ☁️ Infrastructure

| Improvement | Why |
|---|---|
| Upgrade to `t3.medium` (4GB RAM) | The `t3.small` (2GB) struggles even with Swap enabled. A `t3.medium` at ~$0.04/hr removes all memory pressure for a full stack. |
| Prometheus + Grafana | Add the `kube-prometheus-stack` Helm chart via ArgoCD for CPU, memory, pod restart, and HTTP request rate dashboards. |
| Persistent Volume Snapshots | Configure automated PVC snapshots for Kafka's storage so data survives pod rescheduling. |

---

## Summary

| Phase | Tool | Status |
|---|---|---|
| Containerisation | Docker (Multi-stage builds) | ✅ Complete |
| Local K8s Cluster | KIND + kubectl | ✅ Complete |
| K8s Packaging | Helm v3 | ✅ Complete |
| Infrastructure Automation | Ansible | ✅ Complete |
| Continuous Integration | GitHub Actions | ✅ Complete |
| Security Scanning | Aqua Trivy | ✅ Complete |
| Continuous Delivery | ArgoCD (GitOps) | ✅ Complete |
| Observability | Prometheus + Grafana | 🔜 Next Phase |
