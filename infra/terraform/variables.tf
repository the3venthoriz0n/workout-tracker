variable "name" {
  description = "Droplet name and resource prefix."
  type        = string
  default     = "workout-tracker"
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
  default     = "sfo2"
}

variable "size" {
  description = "Droplet size slug."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "image" {
  description = "Droplet base image slug."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "admin_ssh_public_key" {
  description = "Your SSH public key, for the sudo-capable 'admin' user. Passed in by `just infra-*`."
  type        = string
}

variable "deploy_ssh_public_key" {
  description = "CI's SSH public key, for the unprivileged 'deploy' user. Passed in by `just infra-*`."
  type        = string
}

variable "ssh_allowed_cidrs" {
  description = "Sources allowed to reach SSH. Open by default because GitHub-hosted runners use changing IPs; access is key-only."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
