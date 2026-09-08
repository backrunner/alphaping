# Domain routing

Cloudflare custom domains can expose the control plane and public status surfaces
on separate hostnames. Route each hostname to the web Worker, then set
`DOMAIN_ROUTES_JSON` in the real web Wrangler configuration. Public machine and
service routes use their public slugs, never internal resource IDs.

```toml
[vars]
DOMAIN_ROUTES_JSON = '''
{
  "admin.example.com": { "kind": "admin", "workspace": "operations" },
  "status.example.com": { "kind": "status", "workspace": "operations" },
  "edge.example.com": {
    "kind": "machine",
    "workspace": "operations",
    "resource": "public-machine-slug"
  },
  "api.example.com": {
    "kind": "service",
    "workspace": "operations",
    "resource": "public-service-slug"
  }
}
'''
```

The `status`, `machine`, and `service` hostnames render their Guest page directly
at `/`. Guest hostnames reject login and management paths. An `admin` hostname
routes `/` to its configured workspace and retains the normal authenticated
control-plane paths.

D1 Paid Time Travel is the primary 30-day recovery mechanism. Explicit
long-term SQL backups and non-destructive local restore drills are available as
`pnpm db:backup` and `pnpm db:restore:verify`; follow
[`.agents/13-d1-backup-and-recovery.md`](../.agents/13-d1-backup-and-recovery.md)
before using either command with production data.

[Back to README](../README.md)
