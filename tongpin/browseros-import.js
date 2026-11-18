// BrowserOS / BFC local import adapter. Input is user-selected text only.
// No fetch, cookies, Bilibili API, account calls or IndexedDB writes here.
import {bvidOf,cleanText,normalizeImported,MAX_IMPORT} from "./core.js";

const MAX_TEXT_LENGTH=20_000_000;
const allowedHosts=new Set(["www.bilibili.com","m.bilibili.com","bilibili.com"]);
const unique=(arr,max=30)=>[...new Set(arr.filter(Boolean))].slice(0,max);
const object=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
const list=value=>Array.isArray(value)?value:[];
const pick=(...items)=>items.find(x=>x!==undefined&&x!==null);
function decodeEntities(s){
  return String(s||"").replace(/&(?:amp|quot|apos|lt|gt|nbsp|#([0-9]+)|#x([0-9a-f]+));/gi,
    (all,dec,hex)=>{
      if(dec!==undefined||hex!==undefined){
        const n=dec!==undefined?Number(dec):parseInt(hex,16);
        return n>=32&&n<=0x10ffff?String.fromCodePoint(n):"";
      }
      return ({"&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">","&nbsp;":" "})[all.toLowerCase()]||all;
    });
}
function untag(html){
  return cleanText(decodeEntities(String(html||"").replace(/<[^>]*>/g," ")),150);
}
function attr(attrs,name){
  const pattern=new RegExp("(?:^|\\s)"+name+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i");
  const matched=pattern.exec(attrs);
  return matched?decodeEntities(matched[1]??matched[2]??matched[3]??""):"";
}
function fromLink(value){
  try{
    const u=new URL(String(value||""),"https://www.bilibili.com");
    if(!allowedHosts.has(u.hostname)||!["http:","https:"].includes(u.protocol))return null;
    const found=/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/.exec(u.pathname);
    return found?.[1]||null;
  }catch{return null;}
}
function push(rows,entry){
  if(rows.length>=MAX_IMPORT)throw Error("import_limit_30000");
  rows.push(entry);
}
// HTML export from BrowserOS/Chromium bookmarks or a saved Bilibili favorites page.
// Interpret markup as inert text. We never append, evaluate or fetch source HTML.
export function extractBrowserosHtml(html){
  const rows=[],stack=[];
  let pending="";
  const tokens=/<\/?DL\b[^>]*>|<H3\b[^>]*>[\s\S]{0,2000}?<\/H3\s*>|<A\b[^>]{0,4000}>[\s\S]{0,6000}?<\/A\s*>/gi;
  let match;
  while((match=tokens.exec(html))!==null){
    const raw=match[0];
    if(/^<H3\b/i.test(raw)){pending=untag(raw);continue;}
    if(/^<\/DL/i.test(raw)){if(stack.length)stack.pop();continue;}
    if(/^<DL/i.test(raw)){stack.push(pending);pending="";continue;}
    const start=/^<A\b([^>]{0,4000})>/i.exec(raw);
    if(!start)continue;
    const bvid=fromLink(attr(start[1],"href"));
    if(!bvid)continue;
    const inner=raw.slice(start[0].length).replace(/<\/A\s*>$/i,"");
    const title=cleanText(attr(start[1],"title")||untag(inner),150);
    push(rows,{bvid,title,sourceFolders:unique(stack.map(x=>cleanText(x,80)),30)});
  }
  return rows;
}
// BrowserOS (Chromium) bookmark JSON, only explicit roots/children are walked.
// Non-Bilibili bookmarks are ignored. We do NOT scan private notes, cookies, etc.
export function extractBrowserosBookmarks(root){
  const result=[],visited=new Set();
  let count=0;
  function walk(node,folders=[],depth=0){
    if(!node||typeof node!=="object"||depth>32||visited.has(node))return;
    visited.add(node);
    if(++count>150_000)throw Error("bookmark_tree_too_large");
    if(Array.isArray(node)){for(const item of node)walk(item,folders,depth+1);return;}
    const bvid=fromLink(node.url);
    if(bvid)push(result,{bvid,title:cleanText(node.name||node.title,150),sourceFolders:folders});
    const children=list(node.children);
    const next=children.length&&node.name?unique([...folders,cleanText(node.name,80)],30):folders;
    for(const item of children)walk(item,next,depth+1);
  }
  const roots=object(root?.roots);
  if(Object.keys(roots).length){
    for(const [name,node] of Object.entries(roots))walk(node,[cleanText(node?.name||name,80)]);
  }else if(root?.bookmarks||root?.children)walk(root.bookmarks||root);
  return result;
}
// Bilibili's user-exported favorites JSON can store videos under data.medias
// or medias. Keep only explicit media fields; never send the original payload.
export function extractBilibiliMedias(payload){
  const root=object(payload),data=object(root.data);
  const media=Array.isArray(data.medias)?data.medias:Array.isArray(root.medias)?root.medias:
    Array.isArray(data.list)?data.list:Array.isArray(root.mediaList)?root.mediaList:null;
  if(!media)return null;
  if(media.length>MAX_IMPORT)throw Error("import_limit_30000");
  const folder=cleanText(pick(data.info?.title,data.folder?.title,data.title,root.folder?.title,root.folderName),80);
  return media.map(row=>{
    const v=object(row),info=object(v.media);
    const bvid=bvidOf(pick(v.bvid,info.bvid,v.bv_id,v.bvId,v.url));
    return {bvid,title:cleanText(pick(v.title,info.title),150),
      author:cleanText(pick(v.upper?.name,v.owner?.name,v.author,v.uploader),60),
      tags:pick(v.tags,info.tags,[]),sourceFolders:unique([folder,
        ...list(v.sourceFolders).map(x=>cleanText(x,80))],30)};
  });
}
export function inspectBrowserosImport(filename,content){
  const name=cleanText(filename,200);
  const ext=name.toLowerCase().split(".").pop();
  if(!["json","html","htm"].includes(ext))throw Error("unsupported_import_extension");
  if(typeof content!=="string"||content.length>MAX_TEXT_LENGTH)throw Error("import_file_too_large");
  let payload,format;
  if(ext==="json"){
    try{payload=JSON.parse(content);}catch{throw Error("invalid_import_json");}
    const medias=extractBilibiliMedias(payload);
    const bookmark=medias?null:extractBrowserosBookmarks(payload);
    if(medias){
      payload={type:"browseros_bilibili_medias",videos:medias};format="bilibili-medias";
    }else if(bookmark.length){
      payload={type:"browseros_bookmarks",videos:bookmark};format="browseros-bookmarks";
    }else format=payload?.type==="workbench_backup"?"bfc-workbench":
      payload?.type==="tongpin_private_library"?"tongpin-backup":"video-json";
  }else{
    const rows=extractBrowserosHtml(content);
    payload={type:"browseros_bookmarks_html",videos:rows};
    format="bookmark-html";
  }
  const normalized=normalizeImported(payload);
  if(!normalized.items.length)throw Error("no_bilibili_videos");
  const missing=normalized.items.filter(x=>x.metadataMissing).length;
  const folders=new Map();
  for(const item of normalized.items){
    for(const folder of new Set(item.sourceFolders?.length?item.sourceFolders:["未分类"])){
      folders.set(folder,(folders.get(folder)||0)+1);
    }
  }
  return {...normalized,format,missing,folderCounts:[...folders.entries()].sort((a,b)=>b[1]-a[1]),
    // All selected videos are private. Do not auto-select a public showcase draft.
    showcaseDraft:null};
}
