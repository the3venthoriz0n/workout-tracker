terraform {
  required_version = ">= 1.17.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.106"
    }
  }

  # State is local and gitignored (it holds IPs and IDs, never the API token).
  # Losing it means Terraform no longer knows about the Droplet, so back it up,
  # or move it to a DigitalOcean Spaces backend if more than one machine runs this.
}

# Reads the token from the DIGITALOCEAN_TOKEN environment variable.
provider "digitalocean" {}
