import { createHash } from "node:crypto";
import { getCollection } from "astro:content";
import { getAlbums } from "./album-utils";
import { getPostUrlBySlug, url } from "./url-utils";

export type TravelEntry = {
  kind: "post" | "album"; slug: string; title: string; href: string;
  date: string; location: string; series: string; order?: number | null;
};
export type TravelSeries = { name: string; slug: string; href: string; entries: TravelEntry[]; start: string; end: string; locations: string[] };

export function groupTravelSeries(entries: TravelEntry[]): TravelSeries[] {
  const groups = new Map<string, TravelEntry[]>();
  for (const entry of entries) {
    const name = entry.series.trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(entry);
  }
  return [...groups].map(([name, items]) => {
    items.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug));
    const dates = items.map(item => item.date).sort();
    const slug = createHash("sha256").update(name).digest("hex").slice(0, 16);
    return { name, slug, href: url(`/series/${slug}/`), entries: items, start: dates[0], end: dates[dates.length - 1], locations: [...new Set(items.map(item => item.location.trim()).filter(Boolean))] };
  }).sort((a, b) => b.end.localeCompare(a.end) || a.name.localeCompare(b.name, "zh-CN"));
}

export async function getTravelSeries() {
  // A series must never expose unpublished records, including in local preview.
  const posts = await getCollection("posts", ({ data }) => !data.draft);
  const entries: TravelEntry[] = [
    ...posts.map(post => ({ kind: "post" as const, slug: post.slug, title: post.data.title, href: getPostUrlBySlug(post.slug), date: post.data.tripDate || post.data.published.toISOString().slice(0, 10), location: post.data.location, series: post.data.series, order: post.data.seriesOrder })),
    ...getAlbums().map(album => ({ kind: "album" as const, slug: album.slug, title: album.title, href: url(`/albums/${album.slug}/`), date: album.tripDate || album.date, location: album.location, series: album.series, order: album.seriesOrder })),
  ];
  return groupTravelSeries(entries);
}
