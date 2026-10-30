# Deploying Stack AI to AWS

This directory provisions the whole ecosystem into one AWS account and tears it
down again. It is written to be run in order and to be safe to re-run: every
script resolves its resources by name, so a partial failure can be retried
without creating duplicates.

```bash
cd deploy/aws
aws login --profile stack     # short-lived credentials, refreshed every 15 min
./10-foundation.sh            # registry, IAM, logs, security groups, cluster
./15-secrets.sh               # secrets into SSM Parameter Store
./20-database.sh              # RDS Postgres (5-10 minutes)
./30-loadbalancer.sh          # ALB and path routing
./40-cdn.sh                   # CloudFront, for HTTPS
./50-image.sh                 # build for ARM64 and push to ECR
./60-services.sh              # task definitions, migration, three services
# open $PUBLIC_URL/setup and create the first administrator
./70-bootstrap.sh             # templates and the default harness pack
```

## What gets created

| Layer | Resource | Why |
| --- | --- | --- |
| Registry | ECR `stack-app` | one image, three entry points |
| Compute | ECS Fargate, 3 services | no server to patch or administer |
| Database | RDS Postgres `db.t4g.micro` | backups and patching are AWS's problem |
| Ingress | ALB + CloudFront | path routing, and HTTPS without owning a domain |
| Secrets | SSM Parameter Store | no credential in an image or task definition |
| Network | 3 security groups | ALB from CloudFront, tasks from ALB, database from tasks |

One container image serves the portal, the MCP server, the model gateway and the
schema migration. They share `@stack/core`, `@stack/db` and one generated Prisma
client, so separate images would let those drift apart.

## Routing

One load balancer, three target groups, distinguished by path:

```
https://<distribution>.cloudfront.net/         -> portal     :4200
https://<distribution>.cloudfront.net/mcp      -> MCP server :4300
https://<distribution>.cloudfront.net/v1/*     -> gateway    :4400
```

The load balancer is not reachable from the internet directly. Its security
group accepts port 80 only from CloudFront's published address ranges, so the
CDN is the only way in.

## Cost

Everything runs 24x7 in `us-east-2`. Prices are the published on-demand rates.

| Item | Configuration | Per month |
| --- | --- | --- |
| Fargate, portal | 0.5 vCPU, 1 GB, ARM64 | $14.42 |
| Fargate, MCP | 0.25 vCPU, 0.5 GB, ARM64 | $7.21 |
| Fargate, gateway | 0.25 vCPU, 0.5 GB, ARM64 | $7.21 |
| ALB | 1 load balancer | $18.25 |
| Public IPv4 | 3 addresses (ALB plus 2 task ENIs) | $10.95 |
| RDS | `db.t4g.micro`, 20 GB gp3 | $11.68 |
| EBS | 20 GB gp3 for RDS | $1.60 |
| CloudFront | inside the always-free tier | $0.00 |
| **Total** | | **≈ $71** |

ARM64 is chosen over x86 because Fargate charges $0.03238 per vCPU-hour for
Graviton against $0.04048 for x86, and the application is not architecture
sensitive.

A free-plan project caps RDS backup retention at 1 day; 7 days is refused with
`FreeTierRestrictionError`. Automated backups still run, they are just kept for
a day.

## Operating it

```bash
# logs, by service
aws logs tail /ecs/stack --since 30m --filter-pattern portal

# force a redeploy after pushing a new image
IMAGE_TAG=$(git rev-parse --short HEAD) ./50-image.sh
aws ecs update-service --cluster stack --service stack-portal --force-new-deployment

# run the migration again, as a task
aws ecs run-task --cluster stack --task-definition stack-migrate --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-009004c45b2e44eed,subnet-03a242da0322f4e94,subnet-083f3890144840e33],securityGroups=[$(aws ec2 describe-security-groups --filters Name=group-name,Values=stack-task-sg --query 'SecurityGroups[0].GroupId' --output text)],assignPublicIp=ENABLED}"
```

## Tearing it down

The deployment is paid for from a credit balance, so it should not be left
running by accident.

```bash
CONFIRM=yes ./99-teardown.sh
```

This deletes the database with no final snapshot. It removes only resources
named with the `stack` prefix.

## Deliberate choices

**No NAT gateway.** Tasks run in public subnets with a public IP so they can
reach the Anthropic API. A NAT gateway would be $32/month, more than the compute
it would protect.

**Nothing is seeded.** `npm run db:seed` creates demo users and six API tokens
whose values are committed to this repository. A deployment uses
`70-bootstrap.sh` instead, which installs only the templates and the default
harness pack, and creates no tokens.

**No SSH, and no ECS Exec.** There is no instance to log into. ECS Exec is
available but left off: it would require attaching `ssmmessages` permissions to
the task role, and the task role deliberately has none. Debugging happens
through CloudWatch Logs.

**Deletion protection is off on RDS.** That is a deliberate trade in favour of a
clean teardown. Turn it on for anything that is not a demonstration.
