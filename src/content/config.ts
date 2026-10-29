import { defineCollection, z } from "astro:content";
import { normalizePostCategory } from "../utils/post-category.mjs";

const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default("").transform(normalizePostCategory),
		lang: z.string().optional().default(""),
		series: z.string().max(80).default(""),
		tripDate: z.string().default(""),
		location: z.string().max(80).default(""),
		seriesOrder: z.number().int().min(1).max(9999).nullable().optional(),
		featured: z.boolean().optional().default(false),
		photos: z.array(z.object({
			src: z.string(),
			thumbnail: z.string().optional(),
			alt: z.string().optional().default(""),
			width: z.number().positive(),
			height: z.number().positive(),
		})).optional().default([]),
		videos: z.array(z.object({ src: z.string(), caption: z.string().optional().default("") })).optional().default([]),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});
const specCollection = defineCollection({
	schema: z.object({}),
});
export const collections = {
	posts: postsCollection,
	spec: specCollection,
};
