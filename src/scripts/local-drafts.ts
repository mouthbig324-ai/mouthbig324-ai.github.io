export type LocalRecord = {
  kind: string; id: string; sha: string; title: string; date: string;
  description: string; body: string; category: string; tags: string[];
  image: string; featured: boolean; photos: { src: string; alt: string; width: number; height: number; thumbnail?: string }[];
  videos: { src: string; caption: string }[];
  series: string; tripDate: string; location: string; seriesOrder: number | null;
};
export type LocalDraft = { version: 1; key: string; updated: number; record: LocalRecord; baseline: string };
export const draftPrefix = "zuige-local-draft-v1:";
const maximumCharacters = 1_000_000;

// A separate key for each editing session keeps other tabs' copies intact.
// Store only text and media URLs, never credentials or media file contents.
export function listLocalDrafts(storage: Storage): LocalDraft[] {
  const drafts: LocalDraft[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(draftPrefix)) continue;
    const raw = storage.getItem(key);
    try {
      const draft = JSON.parse(raw || "null");
      if (draft?.version === 1 && draft.key === key && typeof draft.updated === "number" &&
          typeof draft.baseline === "string" && ["post", "album"].includes(draft.record?.kind) &&
          typeof draft.record.id === "string" && typeof draft.record.body === "string" &&
          Array.isArray(draft.record.photos) && Array.isArray(draft.record.tags)) drafts.push(draft);
    } catch { /* Preserve an unreadable entry rather than silently deleting it. */ }
  }
  return drafts.sort((a, b) => b.updated - a.updated);
}

export function writeLocalDraft(storage: Storage, draft: LocalDraft) {
  const serialized = JSON.stringify(draft);
  let size = serialized.length;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(draftPrefix) && key !== draft.key) size += (storage.getItem(key) || "").length;
  }
  if (size > maximumCharacters) throw new Error("本机暂存空间已满，请先导出或清理旧暂存；当前内容尚未暂存。");
  storage.setItem(draft.key, serialized);
}
