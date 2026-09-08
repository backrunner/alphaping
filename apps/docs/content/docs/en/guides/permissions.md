---
title: Access control
description: Use workspace roles and resource grants so members can access only the machines and services they need.
order: 4
---

## Three kinds of visitor

| Role          | Access                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| Administrator | All workspace resources, users, system settings and security configuration |
| Member        | Authenticated access with explicit view or manage grants for resources     |
| Guest         | Unauthenticated, read-only access to explicitly public data projections    |

Public registration closes after initial setup. Administrators invite members into the workspace.

## Resource capabilities

`view` grants read access to an authorized resource. `manage` includes `view` and allows changes to that resource. Managing a machine or service does not grant access to system settings, users, keys or other resources.

The interface hides configuration controls without the required permission, while the server independently authorizes every request. Business queries are scoped to the workspace; client-supplied resource IDs do not determine the tenant.

## Denials and inheritance

Explicit denial takes precedence over permission grants. Containers inherit their machine's permissions by default, and administrators can further restrict individual containers.

When reviewing access, consider roles, explicit grants, denial rules and inheritance together. A single selected checkbox does not describe the final permission decision.

## Public visibility and member permissions

Guest access is governed by public projections and never allows management operations. Making a resource public does not grant members management rights or expose every internal field.

Continue with [Public status pages](/docs/guides/status-pages) when configuring a public site.
