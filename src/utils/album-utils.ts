import { z } from "astro:content";
import { url } from "./url-utils";
import { publicMediaUrl } from "./media-utils";

const mediaSource = z.string().refine(value => /^https:\/\//.test(value) || /^\/(?!\/)/.test(value), "照片地址须为 HTTPS 地址或以 / 开头的站内路径");
const albumSchema = z.object({
  title: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().default(""),
  draft: z.boolean().default(false),
  photos: z.array(z.object({
    src: mediaSource,
    thumbnail: mediaSource.optional(),
    alt: z.string().default(""),
    width: z.number().positive(),
    height: z.number().positive(),
  })),
});

export function getAlbums() {
  const files = import.meta.glob("../data/albums/*.json", { eager: true, import: "default" });
  return Object.entries(files).map(([path, data]) => ({
    slug: path.split("/").pop()!.replace(/\.json$/, ""),
    ...albumSchema.parse(data),
  })).filter(album => !album.draft).sort((a, b) => b.date.localeCompare(a.date));
}

export function mediaUrl(source: string) {
  return source.startsWith("https://") ? publicMediaUrl(source) : url(source);
}
