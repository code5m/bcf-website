import test from "node:test";
import assert from "node:assert/strict";
import {inspectBrowserosImport,extractBrowserosBookmarks,extractBrowserosHtml} from "../browseros-import.js";

test("Chromium BrowserOS bookmarks preserve folder ownership and exclude unrelated sites",()=>{
  const input={roots:{bookmark_bar:{name:"书签栏",children:[
    {name:"创作",children:[{name:"私人 AI 教程",url:"https://www.bilibili.com/video/BV1234567890?spm_id_from=2"}]},
    {name:"恶意书签",url:"https://evil.example/video/BV0987654321"},
    {name:"其它收藏",children:[{name:"音乐",url:"https://m.bilibili.com/video/BV0987654321"}]}
  ]}}};
  const result=inspectBrowserosImport("Bookmarks.json",JSON.stringify(input));
  assert.equal(result.format,"browseros-bookmarks");
  assert.equal(result.items.length,2);
  const item=result.items.find(v=>v.bvid==="BV1234567890");
  assert.equal(item.title,"私人 AI 教程");
  assert.deepEqual(item.sourceFolders,["书签栏","创作"]);
  assert.equal(result.showcaseDraft,null);
});
test("Netscape HTML exported bookmarks are inert and retain folder names",()=>{
  const html='<!doctype NETSCAPE-Bookmark-file-1><DL><p><DT><H3>收藏的视频</H3>'+
    '<DL><p><DT><A HREF="https://www.bilibili.com/video/BV1234567890">电影创作教程</A>'+
    '<DT><A HREF="https://evil.example/video/BV1234567890">伪造视频</A></DL>';
  const p=inspectBrowserosImport("bookmarks.html",html);
  assert.equal(p.items.length,1);
  assert.equal(p.items[0].title,"电影创作教程");
  assert.ok(p.items[0].sourceFolders.includes("收藏的视频"));
  assert.equal(extractBrowserosHtml('<img src=x onerror=alert(1)>').length,0);
});
test("BFC workbench payload retains notes/progress/topics without publishing",()=>{
  const backup={type:"workbench_backup",state:{
    videos:{BV1234567890:{bvid:"BV1234567890",title:"视频标题",author:"创作者",
      sourceFolders:["2026 年收藏"]}},
    library:{notes:{BV1234567890:"仅本人阅读的私人笔记"},topics:[
      {name:"创作研究",items:["BV1234567890","BV0987654321"]}],
      progress:{BV1234567890:{percent:57,completed:false}}}
  }};
  const result=inspectBrowserosImport("bfc-backup.json",JSON.stringify(backup));
  assert.equal(result.format,"bfc-workbench");
  assert.equal(result.items.length,2);
  assert.equal(result.missing,1);
  const item=result.items.find(x=>x.bvid==="BV1234567890");
  assert.equal(item.notes,"仅本人阅读的私人笔记");
  assert.equal(item.progress,57);
  assert.ok(item.tags.includes("创作研究"));
  assert.equal(result.topics.length,1);
  assert.equal(result.showcaseDraft,null);
});
test("Bilibili saved medias and duplicates do not invent titles or fetch missing metadata",()=>{
  const source={data:{info:{title:"影视精选"},medias:[
    {bvid:"BV1234567890",title:"真正的标题",upper:{name:"UP"}},{bvid:"BV1234567890",title:""},
    {bvid:"BV0987654321",title:""}
  ]}};
  const result=inspectBrowserosImport("media.json",JSON.stringify(source));
  assert.equal(result.items.length,2);
  assert.equal(result.duplicates,1);
  assert.equal(result.items.find(x=>x.bvid==="BV1234567890").author,"UP");
  assert.ok(result.items.find(x=>x.bvid==="BV1234567890").sourceFolders.includes("影视精选"));
  assert.equal(result.missing,1);
});
test("unsupported files and non-Bilibili URLs are rejected",()=>{
  assert.throws(()=>inspectBrowserosImport("bad.js","{}"),/unsupported_import_extension/);
  assert.throws(()=>inspectBrowserosImport("bad.json","{"),/invalid_import_json/);
  assert.throws(()=>inspectBrowserosImport("empty.html",'<A HREF="https://evil.com/video/BV1234567890">fake</A>'),/no_bilibili_videos/);
  assert.equal(extractBrowserosBookmarks({roots:{a:{name:"x",children:[{name:"bad",url:"https://evil.com/video/BV1234567890"}]}}}).length,0);
});
