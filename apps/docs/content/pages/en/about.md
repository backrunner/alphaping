---
title: About AlphaPing
description: Development status, contributions and licensing for AlphaPing.
---

## Development status

AlphaPing uses a Rust Agent to collect machine metrics and run service checks. The Cloudflare control plane provides the management interface, history queries and public status pages.

The project is in early development. Deployment is currently manual, and native Agent service installation, restart and upgrades require separate validation on each platform.

## Contribute

The repository uses pnpm and Cargo workspaces. After getting the code, run the full local verification:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Read [CONTRIBUTING](https://github.com/BackRunner/alphaping/blob/main/CONTRIBUTING.md) and the [Code of Conduct](https://github.com/BackRunner/alphaping/blob/main/CODE_OF_CONDUCT.md) before contributing. Report issues and suggest improvements on [GitHub](https://github.com/BackRunner/alphaping).

## License

AlphaPing is licensed under [Apache-2.0](https://github.com/BackRunner/alphaping/blob/main/LICENSE). Third-party components retain their respective licenses.
