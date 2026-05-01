# agent-api-server

Helm chart for the reference Hono server implementing `@fuze-ai/agent-api`.

## Install

```sh
helm install agent ./deploy/helm/agent-api-server \
  --namespace fuze --create-namespace \
  --set image.registry=ghcr.io \
  --set image.repository=nericarcasci/agent-api-server \
  --set image.tag=v0.2.0 \
  --set existingSecret=agent-secrets
```

The chart never reads secrets from `values.yaml`. Create a Kubernetes Secret in the same namespace and pass its name via `existingSecret`. Keys are mounted into the container as environment variables.

```sh
kubectl -n fuze create secret generic agent-secrets \
  --from-literal=MISTRAL_API_KEY=... \
  --from-literal=E2B_API_KEY=... \
  --from-literal=KMS_KEY_ID=...
```

## Values reference

| Key                                       | Default                       | Notes                                                |
| ----------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| `image.registry`                          | `ghcr.io`                  | Replace with your OCI registry (e.g. `ghcr.io`).     |
| `image.repository`                        | `nericarcasci/agent-api-server`      | Replace `nericarcasci`.                                     |
| `image.tag`                               | `""` (falls back to appVersion) |                                                    |
| `replicaCount`                            | `2`                           | Ignored when `autoscaling.enabled=true`.             |
| `autoscaling.enabled`                     | `true`                        | Drives the HPA (CPU + memory).                       |
| `existingSecret`                          | `""`                          | Name of an in-cluster Secret with provider keys.     |
| `redis.url`                               | `""`                          | Optional; required for distributed suspend/resume.   |
| `suspendStore.dsn`                        | `""`                          | Optional; persistent suspend-store DSN.              |
| `mtls.sidecar.enabled`                    | `false`                       | Run an mTLS terminator (Envoy) as a pod sidecar.     |
| `mtls.sidecar.configMap`                  | `""`                          | Name of ConfigMap with `envoy.yaml`.                 |
| `serviceMonitor.enabled`                  | `true`                        | Requires the Prometheus Operator CRDs.               |
| `networkPolicy.enabled`                   | `true`                        | Default-deny egress; allowlist below.                |
| `networkPolicy.egress.llmProviders[]`     | mistral / openai / anthropic  | Allowlisted egress hosts.                            |
| `networkPolicy.egress.kms[]`              | `[]`                          | Add the KMS endpoint reachable from the cluster.     |

## Sovereign / mTLS deployments

For the sovereign tier, terminate mTLS at the ingress (preferred) or set `mtls.sidecar.enabled=true` and provide a ConfigMap with `envoy.yaml`. See `deploy/reverse-proxy/` for nginx, Caddy, and Traefik reference configs covering edge termination.

## What the chart does *not* do

- Provision Redis, Postgres, or KMS — bring your own.
- Mint TLS certificates — use cert-manager or your CA out of band.
- Apply Cerbos policies — use the `cerbos-bundle` workflow output.
