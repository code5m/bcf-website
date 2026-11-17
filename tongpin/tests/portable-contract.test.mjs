import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {normalizeImported} from "../core.js";

test("Web v3 portable fixture round trips private notes, numeric progress and a URL-less draft",async()=>{
  const archive=JSON.parse(await readFile(new URL("./fixtures/private-v3.json",import.meta.url),"utf8"));
  const first=normalizeImported(archive);
  assert.equal(first.items.length,2);
  assert.equal(first.topics.length,1);
  const sample=first.items.find(x=>x.bvid==="BV1234567890");
  assert.equal(sample.progress,67.5);
  assert.equal(sample.notes,"我的私人笔记，不得公开");
  assert.deepEqual(sample.sourceFolders,["原收藏夹A"]);
  assert.equal(first.items.find(x=>x.bvid==="BV0987654321").progress,0);
  assert.equal(first.showcaseDraft.length,1);
  assert.equal(first.showcaseDraft[0].url,"https://www.bilibili.com/video/BV1234567890");
  assert.equal(first.showcaseDraft[0].notes,undefined);
  const second=normalizeImported({type:"tongpin_private_library",version:3,
    videos:first.items,topics:first.topics,showcaseDraft:first.showcaseDraft});
  assert.equal(second.items.find(x=>x.bvid==="BV1234567890").progress,67.5);
  assert.deepEqual(second.topics[0].chapters,["构思","拍摄","后期"]);
  assert.equal(second.items[0].notes.includes("私"),true);
});

test("older BFC {percent} progress and a portable numeric value remain distinct",()=>{
  const old=normalizeImported({type:"workbench_backup",state:{
    videos:[{bvid:"BV1234567890",title:"课程"}],
    library:{progress:{"BV1234567890":{percent:63,completed:false}}}
  }});
  assert.equal(old.items[0].progress,63);
  const newer=normalizeImported({type:"tongpin_private_library",version:3,
    videos:[{bvid:"BV1234567890",title:"课程",progress:82}]});
  assert.equal(newer.items[0].progress,82);
});
