# Code Files Index - order-booking-system

## 📁 Directory Structure

Your code is organized in this structure in your repo:

```
order-booking-system/
├── k8s/                          # Kubernetes manifests (V0 - intentionally broken)
│   ├── v0-namespace.yaml
│   ├── v0-configmap.yaml
│   ├── v0-secret.yaml
│   ├── v0-postgres.yaml
│   ├── v0-kafka.yaml
│   ├── v0-order-service.yaml
│   ├── v0-inventory-service.yaml
│   ├── v0-payment-service.yaml
│   └── v0-notification-service.yaml
│
├── scripts/                      # Deployment & setup scripts
│   ├── create-topics.sh          # Create Kafka topics
│   └── v0-deploy.sh              # Deploy to Kubernetes
│
├── src/                          # TypeScript source code
│   ├── config/
│   │   └── index.ts              # Configuration (env vars)
│   ├── db/
│   │   └── client.ts             # Postgres connection pool
│   ├── kafka/
│   │   ├── admin.ts              # Kafka admin client
│   │   ├── client.ts             # Kafka producer/consumer
│   │   └── topics.ts             # Topic definitions
│   ├── models/
│   │   ├── inventory.model.ts    # Inventory data types
│   │   ├── notification.model.ts # Notification data types
│   │   ├── order.model.ts        # Order data types
│   │   └── payment.model.ts      # Payment data types
│   ├── services/
│   │   ├── order-service/        # ⭐ Main API service
│   │   │   ├── index.ts          # Express server, /api/orders endpoint
│   │   │   ├── producers/
│   │   │   │   └── order.producer.ts
│   │   │   └── routes/
│   │   │       └── order.routes.ts
│   │   ├── inventory-service/    # Worker: reserves stock
│   │   │   ├── index.ts          # Kafka consumer, Express server
│   │   │   └── consumers/
│   │   │       └── inventory.consumer.ts
│   │   ├── payment-service/      # Worker: processes payments
│   │   │   ├── index.ts          # Kafka consumer, Express server
│   │   │   └── consumers/
│   │   │       └── payment.consumer.ts
│   │   └── notification-service/ # Worker: sends notifications
│   │       ├── index.ts          # Kafka consumer, Express server
│   │       └── consumers/
│   │           └── notification.consumer.ts
│   ├── tracing.ts                # OpenTelemetry setup
│   └── types/
│       └── index.ts              # TypeScript types
│
├── sql/
│   └── init.sql                  # Database schema
│
├── Dockerfile                    # Multi-stage Docker build
├── docker-compose.yml            # Local development setup
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
│
└── Documentation (you created)
    ├── V0_EXECUTIVE_SUMMARY.md
    ├── V0_IMPLEMENTATION_ROADMAP.md
    ├── V0_SETUP_SUMMARY.md
    ├── V0_DEPLOYMENT_GUIDE.md
    ├── V0_QUICK_START.sh
    ├── V0_QUICK_REFERENCE.txt
    ├── load-test.js
    └── CODE_FILES_INDEX.md (this file)
```

---

## 🔍 Where to Find Files (In Your Repo)

### Kubernetes & Deployment
**Location:** `~/order-booking-system/k8s/`
- `v0-namespace.yaml` — Create obs-v0 namespace
- `v0-configmap.yaml` — Kafka/DB configuration
- `v0-secret.yaml` — Database password
- `v0-postgres.yaml` — PostgreSQL deployment
- `v0-kafka.yaml` — Kafka deployment
- `v0-order-service.yaml` — Order API service
- `v0-inventory-service.yaml` — Inventory worker
- `v0-payment-service.yaml` — Payment worker
- `v0-notification-service.yaml` — Notification worker

**Location:** `~/order-booking-system/scripts/`
- `v0-deploy.sh` — Automated deployment script
- `create-topics.sh` — Kafka topic creation

### Source Code (TypeScript)
**Location:** `~/order-booking-system/src/`

#### Core Services:
1. **Order Service** (API endpoint)
   - `src/services/order-service/index.ts` ← Main file (HTTP server + Kafka producer)
   - Has `/api/orders` POST endpoint
   - Has `/health` GET endpoint (added for v0)
   - Has `/ready` GET endpoint (added for v0)

2. **Inventory Service** (Kafka consumer/worker)
   - `src/services/inventory-service/index.ts` ← Main file
   - Listens to ORDER_CREATED and PAYMENT_FAILED events
   - Reserves stock when order created
   - Releases stock when payment fails
   - Has `/health` and `/ready` endpoints (added for v0)

3. **Payment Service** (Kafka consumer/worker)
   - `src/services/payment-service/index.ts` ← Main file
   - Listens to INVENTORY_RESERVED events
   - Processes payments (simulated)
   - Publishes PAYMENT_PROCESSED or PAYMENT_FAILED events
   - Has `/health` and `/ready` endpoints (added for v0)

4. **Notification Service** (Kafka consumer/worker)
   - `src/services/notification-service/index.ts` ← Main file
   - Listens to PAYMENT_PROCESSED and PAYMENT_FAILED events
   - Sends notifications (simulated)
   - Has `/health` and `/ready` endpoints (added for v0)

#### Supporting Files:
- `src/kafka/client.ts` — Kafka producer/consumer setup
- `src/kafka/topics.ts` — Topic definitions (ORDER_CREATED, INVENTORY_RESERVED, etc.)
- `src/db/client.ts` — PostgreSQL connection pool
- `src/config/index.ts` — Environment variables
- `src/tracing.ts` — OpenTelemetry setup
- `src/models/` — TypeScript interfaces for data

### Database
**Location:** `~/order-booking-system/sql/`
- `init.sql` — Database schema (tables, indexes)

### Configuration
**Location:** `~/order-booking-system/`
- `package.json` — npm dependencies
- `tsconfig.json` — TypeScript configuration
- `Dockerfile` — Multi-stage Docker build
- `docker-compose.yml` — Local development (Postgres, Kafka, etc.)

---

## 📝 Key Files to Review Before Deployment

### 1. Read First (Understanding the System)
```bash
# Architecture overview
cat ~/order-booking-system/README.md  # If exists

# See the database schema
cat ~/order-booking-system/sql/init.sql

# See the Docker setup
cat ~/order-booking-system/Dockerfile
cat ~/order-booking-system/docker-compose.yml
```

### 2. Service Entry Points (Where each service starts)
```bash
# Order Service (HTTP API)
cat ~/order-booking-system/src/services/order-service/index.ts

# Inventory Service (Kafka worker)
cat ~/order-booking-system/src/services/inventory-service/index.ts

# Payment Service (Kafka worker)
cat ~/order-booking-system/src/services/payment-service/index.ts

# Notification Service (Kafka worker)
cat ~/order-booking-system/src/services/notification-service/index.ts
```

### 3. Kubernetes Deployment Manifests
```bash
# Namespace
cat ~/order-booking-system/k8s/v0-namespace.yaml

# Configuration
cat ~/order-booking-system/k8s/v0-configmap.yaml

# Services
cat ~/order-booking-system/k8s/v0-order-service.yaml
cat ~/order-booking-system/k8s/v0-inventory-service.yaml
```

### 4. Deployment Scripts
```bash
# Main deployment script
cat ~/order-booking-system/scripts/v0-deploy.sh

# Load test script
cat ~/order-booking-system/load-test.js
```

---

## 🚀 How to View Files (On Your EC2)

### SSH to your EC2 and view files:
```bash
# View file content
cat ~/order-booking-system/src/services/order-service/index.ts

# Or use less (better for long files)
less ~/order-booking-system/src/services/order-service/index.ts

# Or use nano/vim to edit
nano ~/order-booking-system/src/services/order-service/index.ts
vim ~/order-booking-system/src/services/order-service/index.ts

# List files in a directory
ls -la ~/order-booking-system/src/services/

# Find specific files
find ~/order-booking-system -name "*.ts" -type f
find ~/order-booking-system/k8s -name "*.yaml" -type f
```

### In VS Code (if editing locally):
1. Open the folder: `File → Open Folder → ~/order-booking-system`
2. Left sidebar shows full directory tree
3. Click on any file to view it

---

## 📊 Code Summary

### What Each Service Does

| Service | Type | Port | Purpose |
|---------|------|------|---------|
| **order-service** | HTTP API | 3001 | Accepts POST /api/orders, publishes ORDER_CREATED event |
| **inventory-service** | Kafka Worker | 3002 | Listens to ORDER_CREATED, reserves stock, publishes INVENTORY_RESERVED |
| **payment-service** | Kafka Worker | 3003 | Listens to INVENTORY_RESERVED, processes payment, publishes PAYMENT_PROCESSED/FAILED |
| **notification-service** | Kafka Worker | 3004 | Listens to PAYMENT_PROCESSED/FAILED, sends notifications |

### Event Flow (Saga Pattern)
```
1. Client → POST /api/orders (order-service)
   ↓
2. order-service → Kafka: ORDER_CREATED
   ↓
3. inventory-service ← ORDER_CREATED
   → Kafka: INVENTORY_RESERVED (or INVENTORY_FAILED)
   ↓
4. payment-service ← INVENTORY_RESERVED
   → Kafka: PAYMENT_PROCESSED (or PAYMENT_FAILED)
   ↓
5. notification-service ← PAYMENT_PROCESSED/FAILED
   → Email notification
```

---

## 🔧 Files Modified for V0 (Additions Only)

These files were **updated** to add health endpoints:

### `src/services/order-service/index.ts`
**Added:**
- `app.get('/health', ...)` endpoint
- `app.get('/ready', ...)` endpoint with Kafka/DB checks
- `producerConnected` flag

### `src/services/inventory-service/index.ts`
**Added:**
- Express server setup
- `app.get('/health', ...)` endpoint
- `app.get('/ready', ...)` endpoint
- Server startup in `startWorker()`

### `src/services/payment-service/index.ts`
**Added:**
- Express server setup
- `app.get('/health', ...)` endpoint
- `app.get('/ready', ...)` endpoint
- Server startup in `startWorker()`

### `src/services/notification-service/index.ts`
**Added:**
- Express server setup
- `app.get('/health', ...)` endpoint
- `app.get('/ready', ...)` endpoint
- Server startup in `startWorker()`

**No other logic changed** — only added health check endpoints.

---

## 💾 Files Created by You (Not in Original Repo)

### Documentation
- `V0_EXECUTIVE_SUMMARY.md`
- `V0_IMPLEMENTATION_ROADMAP.md`
- `V0_SETUP_SUMMARY.md`
- `V0_DEPLOYMENT_GUIDE.md`
- `V0_QUICK_REFERENCE.txt`
- `CODE_FILES_INDEX.md` ← This file

### Automation
- `V0_QUICK_START.sh`
- `scripts/v0-deploy.sh` (updated with K8s deployment)

### K8s Manifests
- `k8s/v0-namespace.yaml`
- `k8s/v0-configmap.yaml`
- `k8s/v0-secret.yaml`
- `k8s/v0-postgres.yaml`
- `k8s/v0-kafka.yaml`
- `k8s/v0-order-service.yaml`
- `k8s/v0-inventory-service.yaml`
- `k8s/v0-payment-service.yaml`
- `k8s/v0-notification-service.yaml`

### Testing
- `load-test.js`

---

## 🎯 Next Steps

1. **Clone/navigate to your repo:**
   ```bash
   cd ~/order-booking-system
   git status  # Check if files are there
   ls -la src/services/*/index.ts  # Verify service files
   ls -la k8s/  # Verify K8s manifests
   ```

2. **Review the key files:**
   ```bash
   # Understand the system
   cat src/services/order-service/index.ts
   cat Dockerfile
   cat docker-compose.yml
   ```

3. **Start the deployment:**
   ```bash
   bash V0_QUICK_START.sh
   ```

---

## 🔗 All Files at a Glance

| Category | Location | Files |
|----------|----------|-------|
| **Services** | `src/services/` | order-service, inventory-service, payment-service, notification-service |
| **Kafka** | `src/kafka/` | client.ts, topics.ts, admin.ts |
| **Database** | `src/db/` | client.ts |
| **Config** | `src/config/` | index.ts |
| **K8s Manifests** | `k8s/` | 9 v0-*.yaml files |
| **Scripts** | `scripts/` | v0-deploy.sh, create-topics.sh |
| **Documentation** | `./` | V0_*.md, V0_*.sh, load-test.js |
| **Config** | `./` | Dockerfile, docker-compose.yml, package.json, tsconfig.json |
| **Database** | `sql/` | init.sql |

---

**All code files are in your `~/order-booking-system` repo. Start with the services in `src/services/*/index.ts` to understand how they work!**
