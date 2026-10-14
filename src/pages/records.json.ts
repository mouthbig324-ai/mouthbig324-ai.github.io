import { getCollection } from "astro:content";
import { getAlbums } from "../utils/album-utils";

export async function GET() {
  const posts = await getCollection("posts", ({ data }) => !data.draft);
  const records = [
    ...posts.map(post => ({ kind: "post", id: post.slug, title: post.data.title, date: post.data.published.toISOString().slice(0, 10), draft: false })),
    ...getAlbums().map(album => ({ kind: "album", id: album.slug, title: album.title, date: album.date, draft: false })),
  ];
  return Response.json(records);
}
