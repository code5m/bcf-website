import test from "node:test";
import assert from "node:assert/strict";
import {fullBfcBackup} from "../../full-bfc-backup.js";
import {normalizeImported} from "../core.js";

test("BFC studio export includes full actual video records, not just topic state",()=>{
  const videos={
    BV1234567890:{bvid:"BV1234567890",title:"电影教学",author:"真实字段来自备份",
      raw:{title:"电影教学",pic:"https://i0.hdslb.com/test.jpg"}},
    BV0987654321:{bvid:"BV0987654321",title:"历史课堂",author:"另一位 UP 主"}
  };
  const library={topics:[{id:"one",name:"学习",items:["BV1234567890","BV0987654321"],chapters:["入门"],sections:{}}],
    categories:{"BV1234567890":"电影"},watched:{"BV1234567890":true},
    notes:{"BV1234567890":"我的私人笔记"},progress:{"BV1234567890":{percent:66,completed:false}}};
  const json=fullBfcBackup(videos,library,{date:new Date("2026-11-18T00:00:00Z")});
  assert.equal(json.type,"workbench_backup");
  assert.equal(Object.keys(json.state.videos).length,2);
  assert.equal(json.state.videos.BV0987654321.author,"另一位 UP 主");
  assert.equal(json.state.library.notes.BV1234567890,"我的私人笔记");
  const importResult=normalizeImported(json);
  assert.equal(importResult.items.length,2);
  assert.equal(importResult.items[0].author,"真实字段来自备份");
  assert.equal(importResult.topics.length,1);
  assert.equal(importResult.items[0].notes,"我的私人笔记");
});
test("don't silently export a topic-only file when video records are missing",()=>{
  assert.throws(()=>fullBfcBackup({}, {topics:[]}),/尚未加载真实视频/);
  const result=fullBfcBackup({"BV1234567890":{title:"one"},invalid:{title:"no"}},{topics:[]});
  assert.equal(Object.keys(result.state.videos).length,1);
  assert.equal(result.state.videos.BV1234567890.bvid,"BV1234567890");
});
