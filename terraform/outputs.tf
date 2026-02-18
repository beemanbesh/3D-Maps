# =============================================================================
# 3D Development Visualization Platform - Outputs
# =============================================================================
# Key resource identifiers and endpoints exposed after deployment.
# =============================================================================

# -----------------------------------------------------------------------------
# Load Balancer
# -----------------------------------------------------------------------------

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 zone ID of the Application Load Balancer"
  value       = aws_lb.main.zone_id
}

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------

output "rds_endpoint" {
  description = "Connection endpoint for the RDS PostgreSQL instance"
  value       = aws_db_instance.main.endpoint
}

output "rds_address" {
  description = "Hostname of the RDS PostgreSQL instance (without port)"
  value       = aws_db_instance.main.address
}

# -----------------------------------------------------------------------------
# Cache
# -----------------------------------------------------------------------------

output "redis_endpoint" {
  description = "Connection endpoint for the ElastiCache Redis cluster"
  value       = "${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------

output "s3_bucket_name" {
  description = "Name of the S3 assets bucket"
  value       = aws_s3_bucket.assets.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 assets bucket"
  value       = aws_s3_bucket.assets.arn
}

# -----------------------------------------------------------------------------
# CDN
# -----------------------------------------------------------------------------

output "cloudfront_domain" {
  description = "Domain name of the CloudFront distribution for static assets and 3D models"
  value       = aws_cloudfront_distribution.assets.domain_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.assets.id
}

# -----------------------------------------------------------------------------
# ECS
# -----------------------------------------------------------------------------

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.main.arn
}

# -----------------------------------------------------------------------------
# DNS (conditional)
# -----------------------------------------------------------------------------

output "route53_zone_id" {
  description = "Route53 hosted zone ID (empty if no domain configured)"
  value       = var.domain_name != "" ? aws_route53_zone.main[0].zone_id : ""
}

output "route53_nameservers" {
  description = "Route53 nameservers to configure at your domain registrar"
  value       = var.domain_name != "" ? aws_route53_zone.main[0].name_servers : []
}

output "acm_certificate_arn" {
  description = "ARN of the ACM TLS certificate (empty if no domain configured)"
  value       = var.domain_name != "" ? aws_acm_certificate.main[0].arn : ""
}

# -----------------------------------------------------------------------------
# VPC (for reference by other stacks)
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

# -----------------------------------------------------------------------------
# Platform URL
# -----------------------------------------------------------------------------

output "platform_url" {
  description = "URL to access the 3D development platform"
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
}
