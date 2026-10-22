resource "digitalocean_ssh_key" "admin" {
  name       = "${var.name}-admin"
  public_key = var.admin_ssh_public_key
}

resource "digitalocean_droplet" "app" {
  name       = var.name
  region     = var.region
  size       = var.size
  image      = var.image
  monitoring = true
  ipv6       = false
  backups    = false
  tags       = [var.name]

  # Registering a key also stops DigitalOcean from emailing a root password.
  ssh_keys = [digitalocean_ssh_key.admin.id]

  # First-boot setup; contains public keys only.
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    admin_ssh_public_key  = trimspace(var.admin_ssh_public_key)
    deploy_ssh_public_key = trimspace(var.deploy_ssh_public_key)
  })

  lifecycle {
    # The Droplet holds the production database; never replace it implicitly.
    prevent_destroy = true
    # cloud-init only runs on first boot, so later edits must not force a rebuild.
    ignore_changes = [user_data, ssh_keys, image]
  }
}

# A stable public IP for DNS that survives rebuilding the Droplet.
resource "digitalocean_reserved_ip" "app" {
  region = var.region

  lifecycle {
    # DNS points here; losing it means re-pointing DNS.
    prevent_destroy = true
  }
}

resource "digitalocean_reserved_ip_assignment" "app" {
  ip_address = digitalocean_reserved_ip.app.ip_address
  droplet_id = digitalocean_droplet.app.id
}

resource "digitalocean_firewall" "app" {
  name        = "${var.name}-fw"
  droplet_ids = [digitalocean_droplet.app.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_allowed_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTP/3
  inbound_rule {
    protocol         = "udp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
