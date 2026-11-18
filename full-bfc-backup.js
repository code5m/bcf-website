// Full owner-initiated export for the BFC workbench.
// Never publish this payload in GitHub or transmit it to social endpoints.
const bvid=/^BV[0-9A-Za-z]{10}$/;
const dict=x=>x && typeof x==="object" && !Array.isArray(x)?x:{};
export function fullBfcBackup(videos,library,{date=new Date()}={}){
  const source=dict(videos),records={};
  for(const [key,value] of Object.entries(source)){
    const entry=dict(value);
    const id=entry.bvid||key;
    if(bvid.test(id))records[id]={...entry,bvid:id};
  }
  const count=Object.keys(records).length;
  if(!count)throw Error("当前尚未加载真实视频，无法导出完整收藏。");
  if(count>30000)throw Error("视频超过 30,000 条，请分批导出。");
  const state=dict(library);
  return {
    type:"workbench_backup",version:1,exportedAt:date.toISOString(),
    state:{videos:records,library:state}
  };
}
