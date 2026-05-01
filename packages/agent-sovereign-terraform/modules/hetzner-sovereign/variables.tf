variable "tenant_id" {
  description = "Tenant identifier; tags every resource and namespaces secrets."
  type        = string

  validation {
    condition     = length(var.tenant_id) > 0 && can(regex("^[a-z0-9-]{3,40}$", var.tenant_id))
    error_message = "tenant_id must be 3-40 chars, lowercase alphanumeric and hyphens."
  }
}

variable "wireguard_public_keys" {
  description = "Operator WireGuard public keys (one per peer)."
  type        = list(string)

  validation {
    condition     = length(var.wireguard_public_keys) > 0
    error_message = "wireguard_public_keys must contain at least one operator pubkey."
  }
}

variable "wireguard_public_keys_cidrs" {
  description = "Source CIDRs for operator WireGuard ingress (matches operator-pubkey peers)."
  type        = list(string)
}

variable "proxy_node_cidr" {
  description = "Single proxy node CIDR allowed to reach the control plane on 443/tcp."
  type        = string
}

variable "model_provider_allowlist" {
  description = "EU TLDs (or domains) allowed for model-provider egress (e.g. mistral.ai, scw.cloud, ovh.net, ionos.com)."
  type        = list(string)

  validation {
    condition = alltrue([
      for d in var.model_provider_allowlist :
      can(regex("\\.(ai|eu|fr|de|nl|it|es|cloud|net|com)$", d))
    ])
    error_message = "model_provider_allowlist must contain EU-resident provider domains only."
  }
}

variable "model_provider_egress_cidrs" {
  description = "Resolved CIDRs for the EU model-provider allowlist (operator-supplied)."
  type        = list(string)
}

variable "kms_key_id" {
  description = "KMS key id from the separate KMS bootstrap module (used to encrypt secrets at rest)."
  type        = string
}

variable "packer_image_id" {
  description = "Packer-built Ubuntu 24.04 LTS image id (CIS Benchmark v1.0.0 hardened)."
  type        = string
}

variable "sandbox_node_count" {
  description = "Number of sandbox executor nodes."
  type        = number
  default     = 2
}
