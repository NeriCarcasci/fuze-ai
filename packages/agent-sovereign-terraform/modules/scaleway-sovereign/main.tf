// Scaleway sovereign control plane (EU-resident: PAR / AMS / WAW only).
// Image: Packer-built Ubuntu 24.04 LTS, CIS Benchmark v1.0.0 (Ubuntu 24.04).
// Pinned kernel and hardening applied via cloud-init (../_shared/cloud-init.yaml).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    scaleway = {
      source  = "scaleway/scaleway"
      version = "~> 2.45"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "scaleway" {}

resource "scaleway_vpc_private_network" "sovereign" {
  name = "fuze-${var.tenant_id}"
  ipv4_subnet {
    subnet = "10.42.0.0/24"
  }
  tags = ["fuze", "tenant:${var.tenant_id}", "eu-residency:true"]
}

resource "scaleway_vpc_gateway_network" "sovereign" {
  gateway_id         = var.public_gateway_id
  private_network_id = scaleway_vpc_private_network.sovereign.id
  enable_masquerade  = false
  enable_dhcp        = true
}

resource "scaleway_instance_security_group" "sovereign" {
  name                    = "fuze-${var.tenant_id}-sg"
  inbound_default_policy  = "drop"
  outbound_default_policy = "drop"

  inbound_rule {
    action   = "accept"
    protocol = "UDP"
    port     = 51820
    ip_range = var.operator_ip_range
  }

  inbound_rule {
    action   = "accept"
    protocol = "TCP"
    port     = 443
    ip_range = var.proxy_node_cidr
  }

  dynamic "outbound_rule" {
    for_each = var.model_provider_egress_cidrs
    content {
      action   = "accept"
      protocol = "TCP"
      port     = 443
      ip_range = outbound_rule.value
    }
  }
}

resource "scaleway_instance_server" "control_plane" {
  name              = "fuze-${var.tenant_id}-cp"
  type              = "PRO2-XS"
  image             = var.packer_image_id
  security_group_id = scaleway_instance_security_group.sovereign.id
  user_data = {
    "cloud-init" = file("${path.module}/../_shared/cloud-init.yaml")
  }

  private_network {
    pn_id = scaleway_vpc_private_network.sovereign.id
  }

  tags = [
    "fuze",
    "tenant:${var.tenant_id}",
    "role:control-plane",
    "eu-residency:true",
    "kms:${var.kms_key_id}",
  ]
}
