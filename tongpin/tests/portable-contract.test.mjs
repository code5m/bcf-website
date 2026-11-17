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


test("BrowserOS BFC workbench backup imports real library videos, topics, folders, notes and safe cover URLs",()=>{
  const backup={
    type:"workbench_backup",version:1,exportedAt:"2026-11-18T00:00:00.000Z",
    state:{
      library:{
        videos:{
          BV1234567890:{
            bvid:"BV1234567890",title:"真实收藏视频一",author:"UP主一",
            cover:"https://i0.hdslb.com/bfs/archive/real-cover-1.jpg",
            sourceFolders:["默认收藏夹"],tags:["电影"]
          }
        },
        topics:[{
          name:"电影学习",
          items:[
            {bvid:"BV1234567890",title:"真实收藏视频一",author:"UP主一"},
            {bvid:"BV0987654321",title:"专题中的第二条视频",author:"UP主二",
              coverUrl:"https://archive.biliimg.com/bfs/archive/real-cover-2.jpg",
              sourceFolders:["电影收藏夹"]}
          ]
        }],
        categories:{"BV1234567890":"电影"}
      },
      notes:{"BV1234567890":"只属于本机的私人笔记"},
      progress:{"BV1234567890":{percent:63,completed:false}},
      watched:{"BV0987654321":true},
      videos:{}
    }
  };
  const result=normalizeImported(backup);
  assert.equal(result.kind,"bfc-backup");
  assert.equal(result.items.length,2);
  const first=result.items.find(x=>x.bvid==="BV1234567890");
  const second=result.items.find(x=>x.bvid==="BV0987654321");
  assert.equal(first.title,"真实收藏视频一");
  assert.equal(first.author,"UP主一");
  assert.equal(first.coverUrl,"https://i0.hdslb.com/bfs/archive/real-cover-1.jpg");
  assert.deepEqual(first.sourceFolders,["默认收藏夹"]);
  assert.equal(first.notes,"只属于本机的私人笔记");
  assert.equal(first.progress,63);
  assert.ok(first.tags.includes("电影"));
  assert.ok(first.topics.includes("电影学习"));
  assert.equal(second.title,"专题中的第二条视频");
  assert.equal(second.coverUrl,"https://archive.biliimg.com/bfs/archive/real-cover-2.jpg");
  assert.equal(second.watched,true);
  assert.deepEqual(second.sourceFolders,["电影收藏夹"]);
  assert.equal(result.topics.length,1);
  assert.ok(result.duplicates>=1);
});

test("BrowserOS readback pages are accepted but an incomplete traversal is clearly warned",()=>{
  const result=normalizeImported({
    source:"authorized_browser_readback",
    scanId:"fixture",reportedTotal:80,expectedPages:4,traversalFinished:false,
    pages:{"1":{items:[{bvid:"BV1234567890",title:"页面读取到的收藏"}]}}
  });
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].title,"页面读取到的收藏");
  assert.ok(result.warnings.some(x=>x.includes("部分快照")));
});

test("importer rejects untrusted cover URLs and does not expose private notes in public picks",()=>{
  const result=normalizeImported({type:"workbench_backup",state:{videos:[
    {bvid:"BV1234567890",title:"视频",coverUrl:"https://attacker.example/fake.jpg",
      notes:"PRIVATE_ONLY"}
  ]}});
  assert.equal(result.items[0].coverUrl,"");
  assert.equal(result.items[0].notes,"PRIVATE_ONLY");
  assert.equal(JSON.stringify(result.showcaseDraft||[]).includes("PRIVATE_ONLY"),false);
});
