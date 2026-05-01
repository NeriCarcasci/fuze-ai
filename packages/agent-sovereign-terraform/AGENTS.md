# @fuze-ai/agent-sovereign-terraform

Terraform modules and `.tfvars` generators for self-hosted Fuze Agent infrastructure. EU-sovereign by default.

## Scope

- Production-grade Terraform modules for four cloud targets: Hetzner, Scaleway, OVHcloud, AWS.
- Each module ships a hardened control plane: pinned-kernel Ubuntu 24.04 LTS, WireGuard mesh between operator and sandbox hosts, mTLS-only ingress, deny-all-inbound firewall default, KMS-backed secrets, model-provider egress allowlist (EU TLDs by default).
- TypeScript helpers under `src/` generate per-tenant `.tfvars` and `.tfvars.json` from a `DeploymentSpec`.

## Distribution

The `.tf` files ship as part of the package. Operators have two paths:
1. Use `fuze sovereign init` (in `@fuze-ai/agent-cli`) — copies the chosen module into a target dir and writes `.tfvars`.
2. Copy directly: `cp -r node_modules/@fuze-ai/agent-sovereign-terraform/modules/<cloud>-sovereign ./terraform/`.

`listModules()` returns the inventory; `generateTfVars(spec)` produces HCL + JSON variable files. No Terraform binary is required to use this package — it is a text-resource library plus codegen.

## EU residency

Hetzner, Scaleway, and OVHcloud regions are restricted to EU-resident regions. AWS allows non-EU regions only when the operator explicitly opts in via `DeploymentSpec.region`; the generator rejects non-EU regions for the EU-sovereign tier.
