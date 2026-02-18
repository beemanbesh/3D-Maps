# =============================================================================
# 3D Development Visualization Platform - Variables
# =============================================================================
# All configurable parameters for the infrastructure deployment.
# =============================================================================

# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "devplatform"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.project_name))
    error_message = "Project name must be 3-21 lowercase alphanumeric characters or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment (e.g. production, staging, development)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be one of: production, staging, development."
  }
}

variable "aws_region" {
  description = "AWS region for resource deployment"
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class for PostgreSQL"
  type        = string
  default     = "db.t3.medium"
}

variable "db_name" {
  description = "Name of the application database"
  type        = string
  default     = "devplatform"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "devplatform_admin"
  sensitive   = true
}

variable "db_password" {
  description = "Master password for the RDS instance"
  type        = string
  sensitive   = true
  default     = null
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Cache
# -----------------------------------------------------------------------------

variable "redis_node_type" {
  description = "ElastiCache node type for Redis"
  type        = string
  default     = "cache.t3.small"
}

# -----------------------------------------------------------------------------
# DNS / TLS
# -----------------------------------------------------------------------------

variable "domain_name" {
  description = "Domain name for the platform (e.g. platform.example.com). Leave empty to skip DNS/TLS setup."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Container Images
# -----------------------------------------------------------------------------

variable "container_image_backend" {
  description = "Docker image URI for the backend service"
  type        = string
  default     = ""
}

variable "container_image_frontend" {
  description = "Docker image URI for the frontend service"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# ECS Scaling
# -----------------------------------------------------------------------------

variable "backend_desired_count" {
  description = "Desired number of backend ECS tasks"
  type        = number
  default     = 2
}

variable "frontend_desired_count" {
  description = "Desired number of frontend ECS tasks"
  type        = number
  default     = 2
}

variable "celery_desired_count" {
  description = "Desired number of Celery worker ECS tasks"
  type        = number
  default     = 2
}
