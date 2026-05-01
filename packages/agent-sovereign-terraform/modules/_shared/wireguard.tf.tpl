// Shared WireGuard mesh template referenced by each cloud module.
// Variables expected in the consuming module:
//   var.tenant_id              string
//   var.wireguard_public_keys  list(string)
//   local.wg_listen_port       number (default 51820)

locals {
  wg_listen_port = 51820
  wg_subnet      = "10.42.0.0/24"
}

resource "tls_private_key" "wireguard_server" {
  algorithm = "ED25519"
}

# Operator peers are derived from var.wireguard_public_keys; each entry maps to
# a /32 in the WG subnet and is materialized in cloud-init via the user_data
# template of each cloud module.
output "wg_peer_summary" {
  value = {
    tenant      = var.tenant_id
    listen_port = local.wg_listen_port
    subnet      = local.wg_subnet
    peer_count  = length(var.wireguard_public_keys)
  }
}
