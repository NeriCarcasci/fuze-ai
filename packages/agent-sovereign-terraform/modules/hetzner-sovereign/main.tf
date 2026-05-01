// Hetzner sovereign control plane.
// Image: Packer-built Ubuntu 24.04 LTS, CIS Benchmark v1.0.0 (Ubuntu 24.04).
// Kernel 6.8.0-45 pinned via cloud-init (see ../_shared/cloud-init.yaml).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "hcloud" {}

resource "hcloud_network" "sovereign" {
  name     = "fuze-${var.tenant_id}"
  ip_range = "10.42.0.0/16"
  labels = {
    tenant       = var.tenant_id
    eu_residency = "true"
  }
}

resource "hcloud_network_subnet" "sovereign" {
  network_id   = hcloud_network.sovereign.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.42.0.0/24"
}

resource "hcloud_ssh_key" "operator" {
  count      = length(var.wireguard_public_keys)
  name       = "fuze-${var.tenant_id}-op-${count.index}"
  public_key = var.wireguard_public_keys[count.index]
}

resource "hcloud_firewall" "sovereign" {
  name = "fuze-${var.tenant_id}-fw"

  // Default deny is the absence of allow rules; hcloud_firewall denies all inbound
  // not matched here. Egress without rules is allowed, then narrowed below.

  rule {
    direction = "in"
    protocol  = "udp"
    port      = "51820"
    source_ips = var.wireguard_public_keys_cidrs
    description = "WireGuard from operator allowlist"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = [var.proxy_node_cidr]
    description = "mTLS-only HTTPS from a single proxy node"
  }

  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "443"
    destination_ips = var.model_provider_egress_cidrs
    description     = "Egress to EU model providers (Mistral, Scaleway, OVH, IONOS)"
  }
}

resource "hcloud_server" "control_plane" {
  name        = "fuze-${var.tenant_id}-cp"
  server_type = "cpx31"
  image       = var.packer_image_id
  location    = "fsn1"
  ssh_keys    = hcloud_ssh_key.operator[*].id
  user_data   = file("${path.module}/../_shared/cloud-init.yaml")

  network {
    network_id = hcloud_network.sovereign.id
    ip         = "10.42.0.10"
  }

  firewall_ids = [hcloud_firewall.sovereign.id]

  labels = {
    tenant       = var.tenant_id
    role         = "control-plane"
    eu_residency = "true"
    kms_key_id   = var.kms_key_id
  }

  depends_on = [hcloud_network_subnet.sovereign]
}

resource "hcloud_server" "sandbox" {
  count       = var.sandbox_node_count
  name        = "fuze-${var.tenant_id}-sb-${count.index}"
  server_type = "cpx21"
  image       = var.packer_image_id
  location    = "fsn1"
  ssh_keys    = hcloud_ssh_key.operator[*].id
  user_data   = file("${path.module}/../_shared/cloud-init.yaml")

  network {
    network_id = hcloud_network.sovereign.id
    ip         = "10.42.0.${20 + count.index}"
  }

  firewall_ids = [hcloud_firewall.sovereign.id]

  labels = {
    tenant       = var.tenant_id
    role         = "sandbox"
    eu_residency = "true"
  }

  depends_on = [hcloud_network_subnet.sovereign]
}
