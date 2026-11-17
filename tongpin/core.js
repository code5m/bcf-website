// Tongpin portable, offline-only data contract. Never calls Bilibili or uploads private data.
export const MAX_SHOWCASE = 20;
export const MAX_IMPORT = 30000;
const BV_PATTERN = /BV[0-9A-Za-z]{10}/;

export function bvidOf(input) {
  return String(input ?? "").match(BV_PATTERN)?.[0] || null;
}
export function cleanText(input, max = 120) {
  return (typeof input === "string" || typeof input === "number" ? String(input) : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
export function cleanTopics(value, max = 8) {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、;\n]/) : [];
  return [...new Set(arr.flatMap(item => typeof item === "string" && /[,，、;\n]/.test(item)
    ? item.split(/[,，、;\n]/) : [item]).map(x => cleanText(x, 24)).filter(Boolean))].slice(0, max);
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
      bvid, title, tags: cleanTopics(item.tags, 5),
      caption: cleanText(item.caption, 160), url: videoUrl(bvid)
    };
  });
}
const dictionary = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const shortList = value => Array.isArray(value) ? value : [];
const pick = (...values) => values.find(value => value !== undefined && value !== null);
function readText(source, fallback) {
  return cleanText(pick(source?.title, source?.name, fallback), 150);
}
function mergeUnique(left, right, max = 30) {
  return [...new Set([...left, ...right])].slice(0, max);
}
export function normalizeImported(payload) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_import_file");
  const root = payload.state && typeof payload.state === "object" ? payload.state : payload;
  const library = dictionary(root.library);
  const categories = {...dictionary(root.categories), ...dictionary(library.categories)};
  const notes = {...dictionary(root.notes), ...dictionary(library.notes)};
  const watched = {...dictionary(root.watched), ...dictionary(library.watched)};
  const progress = {...dictionary(root.progress), ...dictionary(library.progress)};
  const topics = shortList(pick(library.topics, root.topics));
  const topicByVideo = new Map();
  const placeholders = new Set();
  if (topics.length > MAX_IMPORT) throw new Error("import_limit_30000");
  for (const topic of topics) {
    if (!topic || typeof topic !== "object") continue;
    const label = cleanText(topic.name || topic.title, 50);
    const members = shortList(topic.items || topic.videos);
    if (members.length > MAX_IMPORT) throw new Error("import_limit_30000");
    for (const item of members) {
      const bvid = bvidOf(typeof item === "string" ? item : item?.bvid || item?.url || "");
      if (!bvid) continue;
      const group = topicByVideo.get(bvid) || [];
      if (label && !group.includes(label)) group.push(label);
      topicByVideo.set(bvid, group.slice(0, 12));
      placeholders.add(bvid);
    }
  }
  const source = Array.isArray(root) ? root :
    pick(root.videos, root.records, root.items, root.data?.list, root.data?.items);
  const sourceEntries = Array.isArray(source) ? source.map((value, index) => [String(index), value]) :
    source && typeof source === "object" ? Object.entries(source) : [];
  if (sourceEntries.length > MAX_IMPORT) throw new Error("import_limit_30000");
  const byId = new Map();
  let rejected = 0, duplicateCount = 0;
  function add(raw, key = "") {
    const row = typeof raw === "string" ? {bvid:raw} : dictionary(raw?.video || raw);
    const base = dictionary(row.raw);
    const bvid = bvidOf(pick(row.bvid, row.bvId, base.bvid, row.url, row.id, key, ""));
    if (!bvid) { rejected++; return; }
    const topicLabels = topicByVideo.get(bvid) || [];
    const fromVideo = cleanText(pick(row.title, row.name, base.title, base.name), 150);
    const isPlaceholder = !fromVideo || /^待补齐标题[ ·]/.test(fromVideo) || /^视频 BV[0-9A-Za-z]{10}$/.test(fromVideo);
    const title = fromVideo && !isPlaceholder ? fromVideo : "待补齐标题 · " + bvid;
    const originalFolders = pick(row.sourceFolders, row.folders, row.originalFolders, base.originalFolders, []);
    const noteValue = pick(notes[bvid], row.notes, row.note, base.note, "");
    const note = typeof noteValue === "string" ? noteValue : cleanText(noteValue?.text, 4000);
    const oldProgress = progress[bvid] || row.progress || {};
    const isWatched = Boolean(watched[bvid] || row.watched || oldProgress?.completed);
    const value = {
      bvid, title, metadataMissing: isPlaceholder,
      author: cleanText(pick(row.author, row.owner?.name, row.upper, base.author, ""), 60),
      tags: cleanTopics([...shortList(row.tags), cleanText(pick(categories[bvid], row.category, row.topic, ""), 24), ...topicLabels], 12),
      topics: [...new Set(topicLabels.map(x=>cleanText(x,80)).filter(Boolean))].slice(0,12),
      notes: cleanText(note, 4000),
      sourceFolders: [...new Set(shortList(originalFolders).map(x=>cleanText(x,80)).filter(Boolean))].slice(0,30),
      watched: isWatched, progress: Number.isFinite(Number(oldProgress?.percent)) ?
        Math.max(0, Math.min(100, Number(oldProgress.percent))) : null,
      url: videoUrl(bvid)
    };
    const prior = byId.get(bvid);
    if (!prior) { byId.set(bvid, value); return; }
    duplicateCount++;
    prior.tags = mergeUnique(prior.tags, value.tags, 12);
    prior.topics = mergeUnique(prior.topics, value.topics, 12);
    prior.sourceFolders = mergeUnique(prior.sourceFolders, value.sourceFolders, 30);
    prior.watched ||= value.watched;
    if (prior.metadataMissing && !value.metadataMissing) {
      prior.title = value.title; prior.metadataMissing = false;
    }
    if (!prior.notes) prior.notes = value.notes;
    if (!prior.author) prior.author = value.author;
  }
  for (const [key, raw] of sourceEntries) add(raw, key);
  // Legacy BFC Studio exports may contain only library topics/categories/progress,
  // without video metadata. Keep known BV references but never invent original titles.
  const orphanIds = new Set([...placeholders, ...Object.keys(categories), ...Object.keys(watched), ...Object.keys(progress)]);
  if (orphanIds.size > MAX_IMPORT) throw new Error("import_limit_30000");
  let metadataOnly = 0;
  for (const id of orphanIds) {
    const bvid = bvidOf(id);
    if (!bvid || bvid !== id || byId.has(bvid)) continue;
    add({bvid, title:"待补齐标题 · " + bvid});
    metadataOnly++;
  }
  if (byId.size > MAX_IMPORT) throw new Error("import_limit_30000");
  const importedTopics = topics.map(t => {
    const sections={};
    for(const [candidate,label] of Object.entries(dictionary(t?.sections)).slice(0,MAX_IMPORT)){
      const id=bvidOf(candidate);
      if(id===candidate) sections[id]=cleanText(label,80);
    }
    return {
      name:cleanText(t?.name,80),description:cleanText(t?.description,500),
      notes:cleanText(t?.notes,4000),chapters:shortList(t?.chapters).map(x=>cleanText(x,80)).filter(Boolean).slice(0,30),
      items:shortList(t?.items).map(x=>bvidOf(x)).filter(Boolean).slice(0,MAX_IMPORT),sections
    };
  }).filter(x=>x.name);
  return {
    items:[...byId.values()], rejected, duplicates:duplicateCount, metadataOnly,
    kind:payload.type === "tongpin_private_library" ? "tongpin" :
      payload.type === "workbench_backup" ? "bfc-backup" :
        topics.length && sourceEntries.length === 0 ? "bfc-topics-only" : "videos",
    topics: importedTopics,
    showcaseDraft: payload.type === "tongpin_private_library" && Array.isArray(payload.showcaseDraft) ?
      normalizeShowcase(payload.showcaseDraft) : null,
    warnings: metadataOnly ? ["部分 BFC 视频缺少标题：已保留 BV 号、专题和进度，请再导入完整 BFC 工作台备份。"] : []
  };
}
export function matchPublic(me, other) {
  const aVideos = new Set((me.showcase || []).map(x=>x.bvid));
  const bVideos = new Set((other.showcase || []).map(x=>x.bvid));
  const aTopics = new Set(cleanTopics(me.profile?.topics || [],20));
  const bTopics = new Set(cleanTopics(other.profile?.topics || [],20));
  const aTags = new Set((me.showcase || []).flatMap(x=>cleanTopics(x.tags || [],5)));
  const bTags = new Set((other.showcase || []).flatMap(x=>cleanTopics(x.tags || [],5)));
  const sharedVideos = [...aVideos].filter(x=>bVideos.has(x));
  const sharedTopics = [...aTopics].filter(x=>bTopics.has(x));
  const sharedTags = [...aTags].filter(x=>bTags.has(x));
  return {
    score: 5*sharedVideos.length + 2*sharedTopics.length + sharedTags.length,
    sharedVideos, sharedTopics, sharedTags
  };
}
