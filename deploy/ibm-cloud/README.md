# IBM Cloud Production Deployment Guide — Sanbook Pay

This guide details the deployment of **Sanbook Pay** on IBM Cloud using either:
1. **IBM Cloud Code Engine** (Fully managed serverless container runtime)
2. **IBM Cloud Kubernetes Service (IKS)** or **Red Hat OpenShift on IBM Cloud (ROKS)**
3. **IBM Cloud Databases for PostgreSQL** & **IBM Cloud Databases for Redis**

---

## 1. Prerequisites

1. IBM Cloud CLI installed:
   ```bash
   curl -fsSL https://clis.cloud.ibm.com/install/linux | sh
   ibmcloud plugin install code-engine
   ibmcloud plugin install container-registry
   ```
2. Log in and target resource group / region:
   ```bash
   ibmcloud login --sso -r in-che -g Default
   ```
3. Provision Managed Data Stores:
   - **IBM Cloud Databases for PostgreSQL** (Standard Plan, min 2 vCPU, 4GB RAM)
   - **IBM Cloud Databases for Redis** (Standard Plan)

---

## 2. Container Registry (ICR) Build & Push

Create a namespace in IBM Cloud Container Registry:
```bash
ibmcloud cr namespace-add sanbook-pay
ibmcloud cr login
```

Build and push the microservice images:
```bash
# Payment API
docker build -t icr.io/sanbook-pay/payment-api:v2.1.0 -f apps/payment-api/Dockerfile .
docker push icr.io/sanbook-pay/payment-api:v2.1.0

# Checkout Portal
docker build -t icr.io/sanbook-pay/checkout-portal:v2.1.0 -f apps/checkout-portal/Dockerfile .
docker push icr.io/sanbook-pay/checkout-portal:v2.1.0

# Merchant Admin
docker build -t icr.io/sanbook-pay/merchant-admin:v2.1.0 -f apps/merchant-admin/Dockerfile .
docker push icr.io/sanbook-pay/merchant-admin:v2.1.0
```

---

## 3. Deployment Option A: IBM Cloud Code Engine

1. Create a Code Engine Project:
   ```bash
   ibmcloud ce project create --name sanbook-pay-prod
   ibmcloud ce project select --name sanbook-pay-prod
   ```

2. Create Secrets Vault in Code Engine:
   ```bash
   ibmcloud ce secret create --name sanbook-pay-secrets \
     --from-literal DATABASE_URL="postgresql://ibm_admin:<password>@<host>:<port>/ibmclouddb?sslmode=verify-full" \
     --from-literal REDIS_URL="rediss://admin:<password>@<host>:<port>" \
     --from-literal ENCRYPTION_KEY="<64_hex_char_master_key>" \
     --from-literal INTERNAL_TOKEN="<random_secure_token>"
   ```

3. Deploy Applications:
   ```bash
   # Deploy Payment API
   ibmcloud ce app create --name sanbook-pay-api \
     --image icr.io/sanbook-pay/payment-api:v2.1.0 \
     --port 6100 \
     --min-scale 2 \
     --max-scale 10 \
     --cpu 1 \
     --memory 2G \
     --env-from-secret sanbook-pay-secrets

   # Deploy Checkout Portal
   ibmcloud ce app create --name sanbook-pay-checkout \
     --image icr.io/sanbook-pay/checkout-portal:v2.1.0 \
     --port 7000 \
     --min-scale 2 \
     --max-scale 5 \
     --env BASE_PAYMENT_API_URL="https://sanbook-pay-api.<region>.codeengine.appdomain.cloud"

   # Deploy Merchant Admin
   ibmcloud ce app create --name sanbook-pay-admin \
     --image icr.io/sanbook-pay/merchant-admin:v2.1.0 \
     --port 6001 \
     --min-scale 1 \
     --max-scale 2 \
     --env BASE_PAYMENT_API_URL="https://sanbook-pay-api.<region>.codeengine.appdomain.cloud"
   ```

4. Configure Custom Domain with Automatic TLS:
   ```bash
   ibmcloud ce domain-mapping create --name pay.yourdomain.com --tls-secret letsencrypt --app sanbook-pay-checkout
   ```

---

## 4. Deployment Option B: IBM Cloud Kubernetes Service (IKS)

1. Connect to IKS Cluster:
   ```bash
   ibmcloud ks cluster config --cluster <your-cluster-id>
   ```

2. Apply Database Schema:
   ```bash
   PGPASSWORD="<password>" psql -h <host> -p <port> -U ibm_admin -d ibmclouddb -f packages/db/src/schema.sql
   ```

3. Create Kubernetes Secrets:
   ```bash
   kubectl create secret generic sanbook-pay-secrets \
     --from-literal=DATABASE_URL="postgresql://ibm_admin:<password>@<host>:<port>/ibmclouddb?sslmode=require" \
     --from-literal=REDIS_URL="rediss://admin:<password>@<host>:<port>" \
     --from-literal=ENCRYPTION_KEY="<64_hex_chars>" \
     --from-literal=INTERNAL_TOKEN="<token>"
   ```

4. Apply Manifests:
   ```bash
   kubectl apply -f deploy/ibm-cloud/k8s-sanbook-pay.yaml
   ```

5. Verify Pods & Endpoints:
   ```bash
   kubectl get pods -l app=sanbook-pay-api
   kubectl get ingress sanbook-pay-ingress
   ```

