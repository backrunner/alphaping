---
title: About AlphaPing
description: An open-source, self-hosted infrastructure monitoring project for individuals, teams and small organizations.
---

## Project direction

AlphaPing connects a lightweight Rust Agent, a Cloudflare control plane and customizable public status pages. Our aim is to make operational state easy to read, with clear control over data and access.

The project is in early development. Deployment is currently manual, and native Agent service installation, restart and upgrades require separate validation on each platform.

## Contribute

The repository uses pnpm and Cargo workspaces. After getting the code, run the full local verification:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Read [CONTRIBUTING](https://github.com/BackRunner/alphaping/blob/main/CONTRIBUTING.md) and the [Code of Conduct](https://github.com/BackRunner/alphaping/blob/main/CODE_OF_CONDUCT.md) before contributing. Report issues and suggest improvements on [GitHub](https://github.com/BackRunner/alphaping).

## Documentation and licensing

This site uses svedocs and follows AlphaPing's design system. It publishes curated public documentation, not internal review records.

AlphaPing is licensed under [Apache-2.0](https://github.com/BackRunner/alphaping/blob/main/LICENSE). Third-party components retain their respective licenses.
