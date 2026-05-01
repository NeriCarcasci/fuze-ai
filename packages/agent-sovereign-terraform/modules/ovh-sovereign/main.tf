// OVHcloud sovereign control plane (EU-resident: GRA / SBG / RBX / WAW).
// Image: Packer-built Ubuntu 24.04 LTS, CIS Benchmark v1.0.0 (Ubuntu 24.04).
// Pinned kernel and hardening applied via cloud-init (../_shared/cloud-init.yaml).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    ovh = {
      source  = "ovh/ovh"
      version = "~> 0.49"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "ovh" {}

resource "ovh_cloud_project_kube" "sovereign" {
  service_name = var.service_name
  name         = "fuze-${var.tenant_id}"
  region       = var.region
  version      = "1.30"

  customization_apiserver {
    admissionplugins {
      enabled  = ["AlwaysPullImages", "PodSecurity", "NodeRestriction"]
      disabled = []
    }
  }

  private_network_id = var.private_network_id
}

resource "ovh_cloud_project_database" "audit_log" {
  service_name = var.service_name
  description  = "Fuze audit + evidence storage (tenant ${var.tenant_id})"
  engine       = "postgresql"
  version      = "16"
  plan         = "business"

  nodes {
    region = var.region
  }

  ip_restrictions {
    description = "WireGuard mesh only"
    ip          = "10.42.0.0/24"
  }

  // Encryption at rest is enforced by OVH for the business plan; KMS reference
  // captured here for the audit trail.
  flavor = "db1-7"
}

# Firewall posture is provided by the project-level network rules; egress is
# limited to var.model_provider_egress_cidrs (EU model providers only) via the
# project-level kubernetes NetworkPolicy referenced by the agent helm chart.
resource "ovh_cloud_project_network_private" "sovereign" {
  service_name = var.service_name
  name         = "fuze-${var.tenant_id}-net"
  regions      = [var.region]
  vlan_id      = var.vlan_id
}
