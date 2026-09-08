---
title: Public status pages
description: Choose what visitors see and share service availability and incident updates under your own brand.
order: 3
---

## Choose what is public

Guests can only view explicitly public dashboards, status pages and resource projections. Check public policies and resource-level overrides before adding resources to a public page.

Machine IPs, detailed Agent versions, request headers and bodies, container environment variables and internal error stacks are hidden from guests by default. Public views contain deliberately selected data.

## Customize appearance

Administrators can open **Admin → Appearance** to set:

- The site title and introduction.
- One of five palettes: Iris, Ocean, Mint, Sunset or Rose.
- A light or dark default, and comfortable or compact density.
- A navigation Logo image.

Logos can use a public HTTPS URL or a site-relative path. Transparent images are contained without cropping; loading failures fall back to the AlphaPing mark.

Visitors can save their own theme preferences in the browser and reset to site defaults. Personal preferences do not write to the database or change resource visibility.

## Read the status timeline

Each capsule represents a fixed time bucket: healthy, degraded, down, maintenance or no data. Hover or use keyboard focus to inspect the time range, availability, latency and failure summary.

No data does not mean healthy. Displayed availability and state depend on actual check results.

## Incidents and announcements

Set an incident's affected services, severity, start time and current status, then append progress updates to its timeline. Updates retain an audit trail; history cannot be silently overwritten.

Announcements have start and expiry times. Expired announcements disappear from query results immediately, with physical cleanup following later. Scheduled maintenance appears separately in the status timeline.

## Custom domains

A custom domain can open a public dashboard, machine or service directly at its root path. Domain routing uses the Web Worker's `DOMAIN_ROUTES_JSON` configuration. Guest hostnames reject login and management routes.

See the [domain routing guide](https://github.com/BackRunner/alphaping/blob/main/docs/domain-routing.md) for configuration and examples.
