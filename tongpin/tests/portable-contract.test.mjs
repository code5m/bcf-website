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


test("1200-video private round trip preserves notes, source folders, topics and numerical progress",()=>{
  const items=Array.from({length:1200},(_,i)=>{
    const bvid="BV"+i.toString(36).padStart(10,"0");
    return {bvid,title:"影片学习 "+i,author:"贡献者",tags:["视频","AI"],
      topics:["个人收藏专题"],sourceFolders:["原B站收藏夹-"+i%4],
      notes:"仅本地私有笔记 #"+i,watched:i%5===0,progress:i%101,metadataMissing:false};
  });
  const input={type:"tongpin_private_library",version:3,videos:items};
  const normalized=normalizeImported(input);
  assert.equal(normalized.items.length,1200);
  const restored=normalizeImported(JSON.parse(JSON.stringify({
    type:"tongpin_private_library",version:3,videos:normalized.items,
    topics:normalized.topics,showcaseDraft:[]
  })));
  const byId=new Map(restored.items.map(x=>[x.bvid,x]));
  assert.equal(byId.size,1200);
  for(const original of items){
    const other=byId.get(original.bvid);
    assert.ok(other,"missing "+original.bvid);
    assert.equal(other.title,original.title);
    assert.equal(other.notes,original.notes);
    assert.equal(other.progress,original.progress);
    assert.equal(other.watched,original.watched);
    assert.deepEqual(other.topics,original.topics);
    assert.deepEqual(other.sourceFolders,original.sourceFolders);
    assert.ok(original.tags.every(tag=>other.tags.includes(tag)),"original tags must survive topic enrichment");
  }
});
