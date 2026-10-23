import { defaultSvedocsMessages } from "svedocs/core";

export const enMessages = {
  ...defaultSvedocsMessages,
  "search.trigger": "Search docs",
  "search.placeholder": "Search deployment, Agents, services…",
  "search.empty": "No matching docs. Try another keyword.",
  "article.edit": "Edit this page on GitHub",
  "theme.system": "System",
  "theme.preference": "Color theme",
  "error.notFound.title": "Page not found",
  "error.notFound.description":
    "This page does not exist or has moved. Search the docs or return to the homepage.",
  "error.generic.description": "Refresh to try again, or use the navigation to continue reading.",
  "ap.nav.deploy": "Deploy",
  "ap.nav.about": "About",
  "ap.locale.switch": "Read this page in {language}",
  "ap.locale.home": "Open the {language} homepage",
  "ap.locale.unavailable": "This page is not available in {language}",
  "ap.brand.home": "AlphaPing home",
  "ap.start": "Deploy AlphaPing",
  "ap.source": "View source",
  "ap.version": "AlphaPing is in early development. Deployment is currently manual.",
  "ap.hero.title": "Self-hosted monitoring for machines and services",
  "ap.hero.description":
    "Monitor machine resources and service availability. Deploy the control plane in your Cloudflare account and run the Agent on Linux, macOS or Windows.",
  "ap.hero.license": "Open source under Apache-2.0",
  "ap.preview.title": "Public status pages",
  "ap.preview.description":
    "Publish selected machines and services, along with incidents and maintenance updates.",
  "ap.preview.alt":
    "Sample AlphaPing public dashboard showing overall status, machine CPU, memory and network metrics",
  "ap.preview.note": "AlphaPing public dashboard with sample data.",
  "ap.preview.link": "Configure a status page",
  "ap.guides.title": "Set up AlphaPing",
  "ap.guides.description": "Deploy the control plane, then connect machines and configure checks.",
  "ap.guide.deploy.title": "Deploy the control plane",
  "ap.guide.deploy.description":
    "Prepare your Cloudflare resources, configure Workers and create your first workspace.",
  "ap.guide.agent.title": "Install an Agent",
  "ap.guide.agent.description":
    "Install the Agent for your platform and register a machine with a one-time token.",
  "ap.guide.services.title": "Add service checks",
  "ap.guide.services.description":
    "Run HTTP and TCP checks from Cloudflare, or HTTP, TCP and ICMP probes from an Agent.",
  "ap.details.title": "Monitoring and access",
  "ap.details.machine.title": "Machine and container metrics",
  "ap.details.machine.text":
    "View CPU, memory, disk and network usage, plus the containers running on each host.",
  "ap.details.history.title": "Live data and history",
  "ap.details.history.text":
    "View live snapshots while a page is open and query history stored in D1. If the live connection drops, the page falls back to stored data.",
  "ap.details.access.title": "Resource permissions",
  "ap.details.access.text":
    "Assign view and manage permissions per resource. Public pages show only the data you choose to publish.",
  "ap.footer.built": "Built with svedocs",
  "ap.footer.copyright": "© 2026 AlphaPing contributors · Apache-2.0",
  "ap.sidebar.overview": "Overview",
  "ap.sidebar.feedback": "Report a documentation issue",
};
