#!/bin/bash
set -e

# Installation steps removed because tools are already installed.

# 7. Create KIND cluster using the saved config
kind create cluster --config k8s/kind-config.yaml

# 8. Install ingress-nginx (for later V1)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/kind/deploy.yaml
echo "Waiting for ingress-nginx..."
kubectl wait --namespace ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=120s

# 9. Build and Deploy
npm install
npm run build
bash scripts/v0-deploy.sh
