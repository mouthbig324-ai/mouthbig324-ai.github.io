import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

const parser = new MarkdownIt({ html: true });

function normalizedSource(source: string): string {
	return parser.normalizeLink(source.trim());
}

function inlineSources(body: string): { photos: Set<string>; videos: Set<string> } {
	const photos = new Set<string>();
	const videos = new Set<string>();
	let inVideo = false;

	const visit = (tokens: Token[]) => {
		for (const token of tokens) {
			if (token.type === "image") {
				const source = token.attrGet("src");
				if (source) photos.add(normalizedSource(source));
			}
			if (token.type === "html_inline" || token.type === "html_block") {
				const html = token.content
					.replace(/<!--[\s\S]*?-->/g, "")
					.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
				const tags = html.matchAll(/<(\/?)(img|video|source)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi);
				for (const [, closing, name, attributes] of tags) {
					const tag = name.toLowerCase();
					if (tag === "video") inVideo = !closing;
					if (closing) continue;
					const attribute = attributes.match(/(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/i);
					const source = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3];
					if (!source) continue;
					const normalized = normalizedSource(parser.utils.unescapeAll(source));
					if (tag === "img") photos.add(normalized);
					else if (tag === "video" || (tag === "source" && inVideo)) videos.add(normalized);
				}
			}
			if (token.children) visit(token.children);
		}
	};
	visit(parser.parse(body, {}));
	return { photos, videos };
}

/** Keep older attachments below the article, without repeating media placed in its body. */
export function unplacedMedia<Photo extends { src: string }, Video extends { src: string }>(
	body: string,
	photos: readonly Photo[],
	videos: readonly Video[] = [],
): { photos: Photo[]; videos: Video[] } {
	const placed = inlineSources(body);
	return {
		photos: photos.filter(photo => !placed.photos.has(normalizedSource(photo.src))),
		videos: videos.filter(video => !placed.videos.has(normalizedSource(video.src))),
	};
}
