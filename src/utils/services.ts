import services from "../data/services.json";
export const apiBase = (import.meta.env.PUBLIC_BLOG_API || services.apiBase).replace(/\/$/, "");
