# AlphaPing documentation

A svedocs 0.2.1 site with AlphaPing's own landing page, navigation, reading layout,
Iris light/dark palette, Geist fonts and glass echo Logo. All 14 pages are available
in Simplified Chinese and English. Local search, code copy, heading anchors, page navigation,
Markdown twins and `llms.txt` use svedocs contracts.

## Run and validate

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:check
pnpm docs:build
```

Development runs at `http://localhost:4174`. `docs:check` runs Svelte/TypeScript and
`svedocs check --strict`. `docs:build` creates the Cloudflare build and performs a
Wrangler deployment dry-run; it does not publish the site. The workspace's normal
`pnpm check`, `pnpm build`, formatting and lint commands include this application.

## Content and theme

- `content/docs`: public documentation, mounted at `/docs`.
- `content/pages`: landing metadata and standalone pages such as `/about`.
- `src/lib/DocumentationApp.svelte`: shared svedocs renderer with the landing slot.
- `src/lib/components/Landing.svelte`: product landing composition.
- `src/lib/theme`: replacements registered through the Vite plugin.
- `src/lib/messages/{zh,en}.ts`: complete Chinese and English interface messages.
- `src/app.css` and `src/lib/styles`: AlphaPing tokens, component styles and responsive behavior.
- `svedocs.config.ts`: the source of truth for content, search, locale and metadata.

Give each page a unique title and useful description in frontmatter. Use `order`
for navigation and route-based links for internal destinations. A folder's
`index.md` supplies its readable navigation title. The site publishes only this
application's content directory; it does not scan repository specifications or
review records.

The homepages set a separate `seoTitle` with the AlphaPing brand and a localized
product description. Article titles use svedocs' `Page title | AlphaPing` format.
Keep title generation in svedocs so the browser tab, social metadata and JSON-LD
stay consistent during direct loads and client navigation. Browser components
must import routing functions from `svedocs/routes`; `svedocs/core` also exports
Node.js content loaders and is only safe there for type-only imports.

## Chinese and English

Chinese is the default language and keeps its existing URLs. English content
mirrors the same relative file paths under each content root's `en/` directory.

| Page             | Chinese                  | English                     |
| ---------------- | ------------------------ | --------------------------- |
| Landing          | `/`                      | `/en`                       |
| Documentation    | `/docs`                  | `/docs/en`                  |
| Deployment guide | `/docs/start/deployment` | `/docs/en/start/deployment` |
| About            | `/about`                 | `/en/about`                 |

Add or update both translations together, including frontmatter, body copy and
meaningful image descriptions. `checks.translations: true` makes `docs:check`
reject missing translations. The Chinese message catalog is type-checked against
the English catalog so new interface keys must be translated too.

Use locale-neutral internal links such as `/docs/start/agent`. svedocs resolves
them in the reader's current language, preserving query strings and fragments.
Use `context.t` and `resolveLocalizedHref` in custom components. Navigation,
sidebars, search, errors, landing text and metadata all follow the current locale.

The navbar switches to the matching article and retains query parameters. Keep
translated sections in the same order and heading hierarchy: section links can
then switch to the corresponding translated heading. Shared heading IDs are
preserved; unknown or mismatched fragments are dropped. Missing translations are
disabled, and error pages offer the other language's homepage. The server hook
sets HTML `lang` and `dir` before JavaScript runs. Set `DOCS_SITE_URL` during the
build for canonical URLs, reciprocal hreflang and sitemap alternates.
Turbo passes this variable to builds and includes it in the cache key, so changing
the public origin cannot reuse pages generated for another hostname.

The Logo and favicon are copies of the product's accepted brand assets. Update
both apps when the canonical Logo changes. Preview images derive from the
synthetic dashboards in `docs/images`, compressed to local WebP files; they are
explicitly labeled as sample data and follow the chosen theme. Fonts are hosted
locally. Runtime dependencies: svedocs (MIT), Geist fonts (SIL OFL-1.1) and Lucide
(ISC); see the repository's third-party notices.
Production builds publish bundled dependency licenses at `/third-party-licenses.txt`
and repository notices at `/third-party-notices.txt`.
The workspace pins `svedocs>sharp` to 0.35.4 to address the inherited libvips
vulnerabilities in svedocs 0.2.1's image build dependency.

## Independent Cloudflare deployment

The only deployment target is Cloudflare Workers + Static Assets. Known content
pages are prerendered; the Worker handles missing routes with a proper 404. Search
runs in the browser. There are no D1, DO, R2, auth, telemetry or AI bindings. The
site adds no monitoring database reads or writes.

1. Copy `wrangler.docs.template.toml` to the ignored `wrangler.docs.toml`, replacing
   the template name and configuring your own hostname as needed.
2. Set `DOCS_SITE_URL` to the site's public HTTPS origin at build time. This enables
   absolute canonical URLs and the sitemap. Without an origin, the local site
   deliberately omits canonical URLs and the sitemap rather than inventing a domain.
3. Validate and build, then inspect the deployment:

   ```bash
   DOCS_SITE_URL=https://docs.example.com pnpm docs:check
   DOCS_SITE_URL=https://docs.example.com pnpm docs:build
   DOCS_SITE_URL=https://docs.example.com pnpm workers:deploy --worker docs --env production --dry-run
   ```

4. When ready to publish, run the same deployment command without `--dry-run`.
   The shared deployment script rebuilds SvelteKit applications before deploying,
   so preserve `DOCS_SITE_URL` for that command too. Production names must remain
   `alphaping-docs-production`.

No database migrations or coordinated control-plane rollout are required. Roll
back the documentation Worker independently. `/llms.txt`, `/llms-full.txt` and
`<page>/index.md` remain available as explicit machine-readable endpoints; header
negotiation is disabled so content can be served as prerendered assets.
