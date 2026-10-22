output "ip" {
  description = "Reserved public IP. Point the domain's A record here."
  value       = digitalocean_reserved_ip.app.ip_address
}

output "droplet_id" {
  value = digitalocean_droplet.app.id
}
