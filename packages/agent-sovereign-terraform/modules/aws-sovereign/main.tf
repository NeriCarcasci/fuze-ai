// AWS sovereign control plane.
// Image: Ubuntu 24.04 LTS AMI (Canonical official, CIS Benchmark v1.0.0 baseline applied via cloud-init).
// Pinned kernel and hardening applied via ../_shared/cloud-init.yaml.

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.region
}

resource "aws_kms_key" "sovereign" {
  description             = "Fuze sovereign tenant ${var.tenant_id} envelope key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags = {
    tenant       = var.tenant_id
    eu_residency = "true"
  }
}

resource "aws_kms_alias" "sovereign" {
  name          = "alias/fuze-${var.tenant_id}"
  target_key_id = aws_kms_key.sovereign.key_id
}

resource "aws_vpc" "sovereign" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = {
    Name         = "fuze-${var.tenant_id}"
    tenant       = var.tenant_id
    eu_residency = "true"
  }
}

resource "aws_subnet" "control_plane" {
  vpc_id            = aws_vpc.sovereign.id
  cidr_block        = "10.42.0.0/24"
  availability_zone = var.availability_zone
  tags = {
    Name = "fuze-${var.tenant_id}-cp"
  }
}

resource "aws_security_group" "sovereign" {
  name        = "fuze-${var.tenant_id}-sg"
  description = "Fuze sovereign control plane (deny-all-inbound default)"
  vpc_id      = aws_vpc.sovereign.id

  // Default: no ingress. Two narrow allow rules, one egress allowlist.
  ingress {
    description = "WireGuard from operator allowlist"
    from_port   = 51820
    to_port     = 51820
    protocol    = "udp"
    cidr_blocks = var.operator_wg_cidrs
  }

  ingress {
    description = "mTLS-only HTTPS from a single proxy node"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.proxy_node_cidr]
  }

  egress {
    description = "Egress to EU model providers (Mistral, Scaleway, OVH, IONOS)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.model_provider_egress_cidrs
  }
}

data "aws_ami" "ubuntu_2404" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_instance" "control_plane" {
  ami                    = var.packer_image_id != "" ? var.packer_image_id : data.aws_ami.ubuntu_2404.id
  instance_type          = "m6i.large"
  subnet_id              = aws_subnet.control_plane.id
  vpc_security_group_ids = [aws_security_group.sovereign.id]
  user_data              = file("${path.module}/../_shared/cloud-init.yaml")

  root_block_device {
    encrypted  = true
    kms_key_id = aws_kms_key.sovereign.arn
    volume_size = 50
  }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  tags = {
    Name         = "fuze-${var.tenant_id}-cp"
    tenant       = var.tenant_id
    role         = "control-plane"
    eu_residency = var.region == "eu-west-1" || var.region == "eu-central-1" || var.region == "eu-west-3" || var.region == "eu-north-1" ? "true" : "false"
  }
}
