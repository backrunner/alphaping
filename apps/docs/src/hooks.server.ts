import type { Handle } from "@sveltejs/kit";
import { resolveLocaleCodeFromPath } from "svedocs/theme/headless";
import config from "virtual:svedocs/config";

export const handle: Handle = ({ event, resolve }) => {
  const localeCode = resolveLocaleCodeFromPath(event.url.pathname, config);
  const locale = config.i18n.locales.find((item) => item.code === localeCode);
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html
        .replace("%alphaping.lang%", locale?.hreflang ?? localeCode)
        .replace("%alphaping.dir%", locale?.dir ?? "ltr"),
  });
};
