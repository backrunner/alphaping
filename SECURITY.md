# Security Policy

## Supported Versions

AlphaPing is in early development. Security fixes are applied to the latest
commit on the default branch until versioned releases define a wider support
window.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting for `BackRunner/alphaping`. If that is unavailable, email
`dev@backrunner.top` with the subject `AlphaPing security report`.

Include the affected component and version, reproduction steps, impact, and any
suggested mitigation. Do not include live credentials, customer data, private
keys, or destructive proof-of-concept actions. You should receive an
acknowledgement within five business days.

The maintainers will validate the report, coordinate a fix and disclosure
timeline, and credit reporters who request attribution. Please allow a
reasonable remediation period before public disclosure.

## Scope

Reports about Agent enrollment, cryptographic envelopes, replay protection,
resource authorization, public-data projection, service-check SSRF, signed
updates, installers, and Cloudflare Worker isolation are in scope. General
support requests and findings that require access to an already-compromised
deployment owner account are not security reports unless they cross a documented
trust boundary.
