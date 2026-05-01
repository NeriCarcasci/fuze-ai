output "vpc_id" {
  description = "Hetzner network id."
  value       = hcloud_network.sovereign.id
}

output "control_plane_ip" {
  description = "Internal IP of the control plane server."
  value       = hcloud_server.control_plane.network[0].ip
}

output "wireguard_endpoint" {
  description = "Public WireGuard endpoint for operator peers."
  value       = "${hcloud_server.control_plane.ipv4_address}:51820"
}

output "agent_api_url" {
  description = "Internal mTLS HTTPS endpoint for the Fuze Agent API."
  value       = "https://${hcloud_server.control_plane.network[0].ip}:443"
}
