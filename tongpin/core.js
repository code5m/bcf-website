// "同频" shared domain logic. No networking, no user tracking.
export const MAX_SHOWCASE = 20;
export const MAX_IMPORT = 30000;
const BV_PATTERN = /BV[0-9A-Za-z]{10}/;

export function bvidOf(input) {
  const found = String(input ?? "").match(BV_PATTERN);
  return found ? found[0] : null;
}
export function cleanText(input, max = 120) {
  return String(input ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
export function cleanTopics(value, max = 8) {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、;\n]/) : [];
  return [...new Set(arr.map(x => cleanText(x, 24)).filter(Boolean))].slice(0, max);
}
export function videoUrl(bvid) {
  return "https://www.bilibili.com/video/" + bvid;
}
export function normalizeShowcase(items) {
  if (!Array.isArray(items) || items.length > MAX_SHOWCASE) throw new Error("showcase_limit_20");
  const seen = new Set();
  return items.map(item => {
    const bvid = bvidOf(item?.bvid);
    if (!bvid || bvid !== item.bvid || seen.has(bvid)) throw new Error("invalid_or_duplicate_video");
    seen.add(bvid);
    const title = cleanText(item.title, 120);
    if (!title) throw new Error("video_title_required");
    return {
      bvid, title,
      tags: cleanTopics(item.tags, 5),
      caption: cleanText(item.caption, 160),
      url: videoUrl(bvid)
    };
  });
}
export function normalizeImported(payload) {
  const root = payload?.state || payload || {};
  const source = Array.isArray(root) ? root : root.videos || root.records || root.items || root.data?.list || root.data?.items || [];
  const rows = Array.isArray(source) ? source : source && typeof source === "object" ? Object.values(source) : [];
  if (rows.length > MAX_IMPORT) throw new Error("import_limit_30000");
  const categories = root.library?.categories || {};
  const notes = root.library?.notes || {};
  const byId = new Map();
  let rejected = 0;
  for (const original of rows) {
    const row = original?.video || original;
    const bvid = bvidOf(typeof row === "string" ? row : row?.bvid || row?.bvId || row?.id || row?.url || "");
    if (!bvid) { rejected++; continue; }
    const sourceFolders = Array.isArray(row?.sourceFolders) ? row.sourceFolders :
      Array.isArray(row?.folders) ? row.folders : Array.isArray(row?.originalFolders) ? row.originalFolders : [];
    const topic = categories[bvid] || row?.category || row?.topic || "";
    const note = notes[bvid] || row?.notes || "";
    const title = cleanText(row?.title || row?.name || "视频 " + bvid, 150);
    const item = {
      bvid, title, author: cleanText(row?.author || row?.owner?.name || row?.upper || "", 60),
      tags: cleanTopics([...(Array.isArray(row?.tags) ? row.tags : []), topic], 12),
      notes: cleanText(typeof note === "string" ? note : note?.text || "", 4000),
      sourceFolders: [...new Set(sourceFolders.map(x => cleanText(x, 60)).filter(Boolean))].slice(0, 30),
      url: videoUrl(bvid)
    };
    if (!byId.has(bvid)) byId.set(bvid, item);
    else {
      const previous = byId.get(bvid);
      previous.tags = [...new Set([...previous.tags, ...item.tags])].slice(0, 12);
      previous.sourceFolders = [...new Set([...previous.sourceFolders, ...item.sourceFolders])].slice(0, 30);
    }
  }
  return {items: [...byId.values()], rejected, duplicates: rows.length - rejected - byId.size};
}
export function matchPublic(me, other) {
  const aVideos = new Set((me.showcase || []).map(x => x.bvid));
  const bVideos = new Set((other.showcase || []).map(x => x.bvid));
  const aTopics = new Set(cleanTopics(me.profile?.topics || [], 20));
  const bTopics = new Set(cleanTopics(other.profile?.topics || [], 20));
  const aTags = new Set((me.showcase || []).flatMap(x => cleanTopics(x.tags || [], 5)));
  const bTags = new Set((other.showcase || []).flatMap(x => cleanTopics(x.tags || [], 5)));
  const sharedVideos = [...aVideos].filter(x => bVideos.has(x));
  const sharedTopics = [...aTopics].filter(x => bTopics.has(x));
  const sharedTags = [...aTags].filter(x => bTags.has(x));
  return {
    score: 5 * sharedVideos.length + 2 * sharedTopics.length + sharedTags.length,
    sharedVideos, sharedTopics, sharedTags
  };
}
