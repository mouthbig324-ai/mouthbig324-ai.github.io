import services from "../data/services.json" with { type: "json" };

type MediaServices = { apiBase: string; mediaBase?: string };

/** Keep stored URLs stable while allowing the public media domain to change. */
export function publicMediaUrl(source: string, settings: MediaServices = services): string {
  if (!settings.mediaBase || !source.startsWith("https://")) return source;
  try {
    const original = new URL(source);
    const api = new URL(settings.apiBase);
    const media = new URL(settings.mediaBase);
    const apiPath = api.pathname.replace(/\/+$/, "");
    if (
      api.protocol !== "https:" || media.protocol !== "https:" ||
      original.origin !== api.origin || original.username || original.password ||
      !original.pathname.startsWith(`${apiPath}/media/`)
    ) return source;

    media.pathname = media.pathname.replace(/\/+$/, "") + original.pathname.slice(apiPath.length);
    media.search = original.search;
    media.hash = original.hash;
    return media.href;
  } catch {
    return source;
  }
}
