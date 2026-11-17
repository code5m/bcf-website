import {bvidOf, cleanTopics, normalizeImported, MAX_SHOWCASE} from "./core.js";

const $ = id => document.getElementById(id);
const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const errors = {
  login_required:"请先登录，私人收藏仍可离线使用。",
  invite_code_required:"此服务实行邀请制，请填写未使用的有效邀请码。",
  account_suspended:"当前账号已暂停社交操作，可导出数据或申请删除。",
  invalid_credentials:"用户名或密码错误。",
  handle_taken:"用户名已被使用，请换一个。",
  adult_and_terms_required:"使用社交功能需要年满 18 岁并同意条款。",
  publish_showcase_first:"请先精选至少一个视频并发布橱窗。",
  showcase_limit_20:"公开橱窗最多支持 20 条视频。",
  peer_not_discoverable:"对方已关闭发现或不再允许申请。",
  request_exists:"已经申请或成为好友。",
  friendship_required:"请先成为好友再发送消息。",
  peer_blocked:"已拉黑或被对方拉黑，无法继续联系。",
  too_many_requests:"操作太频繁，请稍后重试。",
  same_origin_required:"安全验证未通过，请刷新页面后重试。",
  publish_requires_login:"请先登录，才可以发布收藏橱窗。",
  local_storage_unavailable:"浏览器本地存储不可用，请使用支持 IndexedDB 的浏览器。",
  invalid_import_file:"JSON 备份格式错误，请使用同频或 BFC 的备份。",
  invalid_handle_or_password:"用户名需 3–20 位英文/数字/下划线，密码至少 12 位。",
  invalid_password:"密码验证失败。",
  invalid_or_duplicate_video:"橱窗包含重复或不合法 BV 视频。",
  session_changed:"密码已更新，请重新登录。"
};
function notify(text, isError = false) {
  const box = $("notice");
  box.textContent = String(text);
  box.classList.toggle("error", isError);
  box.hidden = false;
}
const state = {
  items: [], showcase: [], user: null, people: [], connections: [], blocked: [],
  chatPeer: null, chatMessages: [], topics: [], tab: "library", page: 1, authMode: "register", localReady:false, reportTarget:null
};
let db;
function openLocal() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("tongpin-private-library", 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains("videos")) database.createObjectStore("videos", {keyPath:"bvid"});
      if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings", {keyPath:"key"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txGetAll(store) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store,"readonly");
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function txGet(store, key) {
  return new Promise((resolve,reject) => {
    const request = db.transaction(store,"readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function txPutMany(store, values) {
  return new Promise((resolve,reject) => {
    const tx=db.transaction(store,"readwrite");
    for(const value of values)tx.objectStore(store).put(value);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
}
function txDelete(store, key) {
  return new Promise((resolve,reject) => {
    const tx=db.transaction(store,"readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
async function saveShowcase() {
  await txPutMany("settings", [{key:"showcase",value:state.showcase}]);
}
async function refreshLocal() {
  state.items = (await txGetAll("videos")).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
  state.showcase = (await txGet("settings","showcase"))?.value || [];
  state.topics = (await txGet("settings","topics"))?.value || [];
  state.localReady=true;
  renderLocal();
}
async function api(path,method="GET",payload) {
  let res;
  try {
    res=await fetch("/api/social"+path,{
      method,credentials:"same-origin",
      headers:method==="GET"?{}:{"Content-Type":"application/json","X-Tongpin-Request":"1"},
      body:payload===undefined?undefined:JSON.stringify(payload)
    });
  }catch { throw new Error("社交服务不可连接。你仍可使用私人收藏。"); }
  let data;
  try {data=await res.json();}catch{throw new Error("服务响应异常");}
  if(!res.ok)throw new Error(errors[data.error]||"请求失败："+(data.error||res.status));
  return data;
}
async function loadSession() {
  try { state.user=(await api("/session")).user; }
  catch { state.user=null; }
  renderAuth();
}
function setTab(tab) {
  if(!["library","learning","showcase","discover","friends","account"].includes(tab))tab="library";
  state.tab=tab;
  document.querySelectorAll("[data-tab]").forEach(el=>{
    el.classList.toggle("active",el.dataset.tab===tab);
    el.setAttribute("aria-current",el.dataset.tab===tab?"page":"false");
  });
  document.querySelectorAll(".panel-section").forEach(el=>el.hidden=el.id!=="tab-"+tab);
  $("page-title").textContent=({
    library:"我的收藏",learning:"学习专题",showcase:"收藏橱窗",discover:"发现同频",friends:"好友与消息",account:"账户设置"
  })[tab];
  if(tab==="learning")renderLearning();
  if(tab==="discover")refreshPeople();
  if(tab==="friends")refreshConnections();
  if(tab==="showcase")renderShowcase();
}
function tagsHtml(tags) {
  return (tags||[]).slice(0,8).map(t=>'<span class="tag">'+escapeHtml(t)+'</span>').join("");
}
function empty(title,desc) {
  return '<div class="empty-state"><strong>'+escapeHtml(title)+'</strong>'+escapeHtml(desc)+'</div>';
}
function cardHtml(item,place) {
  const inDraft=state.showcase.some(x=>x.bvid===item.bvid);
  const card = '<div class="card-top"><span>'+escapeHtml(item.bvid)+'</span><a href="'+
    "https://www.bilibili.com/video/"+encodeURIComponent(item.bvid)+
    '" target="_blank" rel="noopener noreferrer">去 B站观看 ↗</a></div>'+
    '<h4>'+escapeHtml(item.title)+'</h4><p>'+escapeHtml(item.author||"")+'</p>'+
    '<div class="tags">'+tagsHtml(item.tags)+'</div>'+
    (place==="library"&&item.notes?'<p>私人笔记：'+escapeHtml(item.notes.slice(0,110))+'</p>':"")+
    '<div class="card-actions">';
  const buttons=place==="library"
    ?'<button data-action="edit" data-id="'+item.bvid+'">编辑</button>'+
    '<button class="'+(inDraft?"":"highlight")+'" data-action="toggle" data-id="'+item.bvid+'">'+(inDraft?"移出橱窗草稿":"加入橱窗草稿")+'</button>'+
    '<button data-action="remove" data-id="'+item.bvid+'">删除本地记录</button>'
    :'<button data-action="toggle" data-id="'+item.bvid+'">移出草稿</button>';
  return '<article class="video-card">'+card+buttons+'</div></article>';
}
function renderLocal() {
  $("stat-count").textContent=state.items.length.toLocaleString("zh-CN");
  $("stat-topics").textContent=new Set(state.items.flatMap(i=>i.tags||[])).size.toLocaleString("zh-CN");
  $("stat-shared").textContent=state.user?.showcase?.length||0;
  const tags=[...new Set(state.items.flatMap(i=>i.tags||[]))].sort();
  const tagSelect=$("library-tag");
  const chosen=tagSelect.value;
  tagSelect.replaceChildren(new Option("全部标签",""),...tags.map(t=>new Option(t,t)));
  tagSelect.value=tags.includes(chosen)?chosen:"";
  const q=$("library-search").value.trim().toLowerCase();
  const filtered=state.items.filter(i=>(!tagSelect.value||(i.tags||[]).includes(tagSelect.value))&&
    (!q||[i.title,i.bvid,i.author,...(i.tags||[])].join(" ").toLowerCase().includes(q)));
  const pages=Math.max(1,Math.ceil(filtered.length/24));
  state.page=Math.min(state.page,pages);
  $("library-list").innerHTML=filtered.length?filtered.slice((state.page-1)*24,state.page*24).map(i=>cardHtml(i,"library")).join("")
    :empty("还没有符合条件的收藏","手动添加 BV 号，或导入已有 BFC JSON 备份。");
  $("library-page-label").textContent="第 "+state.page+" / "+pages+" 页 · "+filtered.length+" 条";
  $("page-prev").disabled=state.page===1;
  $("page-next").disabled=state.page>=pages;
  renderShowcase();
  renderLearning();
}
function renderShowcase() {
  const items=state.showcase;
  $("published-summary").textContent=state.user?.showcase?.length
    ? "服务器已公开 "+state.user.showcase.length+" 条精选收藏；当前浏览器草稿 "+items.length+" 条。编辑草稿不会自动改变公开内容。"
    : "服务器尚未公开任何精选收藏，当前草稿 "+items.length+" 条。";
  $("showcase-list").innerHTML=items.length?items.map(x=>cardHtml(x,"showcase")).join("")
    :empty("公开橱窗还没有草稿","在「我的收藏」里选择你愿意公开的视频。");
}

function renderLearning() {
  const videos=new Map(state.items.map(item=>[item.bvid,item]));
  const savedTopics=state.topics.filter(t=>t && typeof t.name==="string" && Array.isArray(t.items));
  const topics=savedTopics.length?savedTopics:
    [...new Set(state.items.flatMap(item=>item.tags||[]))].slice(0,24).map(tag=>({
      name:tag, items:state.items.filter(item=>(item.tags||[]).includes(tag)).map(item=>item.bvid)
    }));
  const el=$("learning-list");
  if(!topics.length){el.innerHTML=empty("还没有学习专题","可以导入 BFC 备份，或先为私人收藏添加标签。");return;}
  el.innerHTML=topics.slice(0,36).map((topic,index)=>{
    const selected=[...new Set(topic.items.map(x=>bvidOf(x)).filter(Boolean))].map(id=>videos.get(id)).filter(Boolean);
    const done=selected.filter(x=>x.watched).length;
    const percentage=selected.length?Math.round(done/selected.length*100):0;
    return '<article class="topic-card"><div class="topic-heading"><div><span class="overline">LEARNING TRACK '+(index+1)+'</span><h4>'+
      escapeHtml(topic.name)+'</h4></div><span class="progress-number">'+done+'/'+selected.length+'</span></div>'+
      '<p>'+escapeHtml(topic.description||"将保存的内容变成有序的学习计划。")+'</p>'+
      '<div class="progress-track"><span style="width:'+percentage+'%"></span></div>'+
      (selected.length?'<div class="topic-videos">'+selected.slice(0,12).map(v=>'<div class="topic-video">'+
        '<button type="button" data-action="watched" data-id="'+v.bvid+'" class="watched-toggle" aria-pressed="'+Boolean(v.watched)+'">'+(v.watched?"✓ 已学":"○ 待学")+'</button>'+
        '<a href="'+v.url+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(v.title)+'</a></div>').join("")+
        (selected.length>12?'<p class="small-copy">本专题共 '+selected.length+' 条；这里只显示前12条。</p>':"")+'</div>':
        '<p>本机尚无此专题的视频元数据，可导入完整 BFC 工作台备份补齐。</p>')+'</article>';
  }).join("");
}

function renderAuth() {
  const logged=Boolean(state.user);
  $("session-label").textContent=logged?"@"+state.user.handle:"离线私人模式";
  $("login-shortcut").textContent=logged?"我的资料":"登录 / 注册";
  $("auth-panel").hidden=logged;
  $("profile-panel").hidden=!logged;
  $("stat-shared").textContent=state.user?.showcase?.length||0;
  if(logged){
    const form=$("profile-form");
    form.elements.displayName.value=state.user.displayName||"";
    form.elements.bio.value=state.user.bio||"";
    form.elements.topics.value=(state.user.topics||[]).join(", ");
    form.elements.city.value=state.user.city||"";
    form.elements.discoverable.checked=Boolean(state.user.discoverable);
  }
}
function renderAuthMode() {
  const register=state.authMode==="register";
  $("auth-mode-register").classList.toggle("active",register);
  $("auth-mode-login").classList.toggle("active",!register);
  $("display-name-field").hidden=!register;
  $("invite-field").hidden=!register;
  $("adult-field").hidden=!register;
  $("auth-submit").textContent=register?"创建账号":"登录";
  $("auth-form").elements.password.autocomplete=register?"new-password":"current-password";
}
function renderPeople() {
  $("discover-list").innerHTML=!state.user?empty("登录后才能发现同频的人","你的私人收藏始终不会被同步用于推荐。")
  :state.people.length?state.people.map(u=>{
    const match=u.match||{sharedVideos:[],sharedTags:[],sharedTopics:[],score:0};
    return '<article class="person-card"><div class="person-header"><div class="avatar">'+escapeHtml((u.displayName||"?").slice(0,1))+'</div>'+
      '<div><h4>'+escapeHtml(u.displayName)+'</h4><span class="match-score">'+
      match.score+' 分 · 共同公开视频 '+match.sharedVideos.length+' 条</span></div></div>'+
      '<p>@'+escapeHtml(u.handle)+(u.city?" · "+escapeHtml(u.city):"")+'</p><p>'+escapeHtml(u.bio||"这个人还没有填写简介")+'</p>'+
      '<div class="tags">'+tagsHtml(match.sharedTopics.concat(match.sharedTags))+'</div>'+
      '<p>精选收藏：'+escapeHtml(u.showcase.map(s=>s.title).slice(0,3).join(" · "))+'</p>'+
      '<div class="card-actions"><button class="highlight" data-action="request" data-id="'+u.id+'"'+(u.relationship!=="none"?" disabled":"")+'>'+
      (u.relationship==="none"?"申请交友":u.relationship==="accepted"?"已是好友":"已申请")+'</button>'+
      '<button data-action="report" data-id="'+u.id+'">举报</button><button data-action="block" data-id="'+u.id+'">拉黑</button></div></article>';
  }).join(""):empty("暂时没有可发现的人","其他用户需要主动公开收藏并开启被发现功能。这里不会创建虚拟匹配对象。");
}
function renderConnections() {
  const connections=state.connections;
  const incoming=connections.filter(c=>c.status==="pending" && c.direction==="incoming").length;
  $("pending-count").hidden=incoming===0;
  $("pending-count").textContent=String(incoming);
  $("friends-list").innerHTML=!state.user?empty("请先登录","只有双方同意才能建立联系。"):connections.length?
    connections.map(c=>'<article class="person-card"><div class="person-header"><div class="avatar">'+escapeHtml(c.peer.displayName.slice(0,1))+'</div><div><h4>'+
      escapeHtml(c.peer.displayName)+'</h4><p>@'+escapeHtml(c.peer.handle)+'</p></div></div>'+
      '<p>'+ (c.status==="accepted"?"已成为好友":c.direction==="incoming"?"对方向你发来交友申请":"等待对方接受申请")+'</p><div class="card-actions">'+
      (c.status==="pending"&&c.direction==="incoming"?'<button class="highlight" data-action="accept" data-id="'+c.id+'">同意</button><button data-action="decline" data-id="'+c.id+'">拒绝</button>':"")+
      (c.status==="accepted"?'<button class="highlight" data-action="chat" data-id="'+c.peer.id+'" data-name="'+escapeHtml(c.peer.displayName)+'">聊天</button><button data-action="unfriend" data-id="'+c.id+'">解除好友</button>':"")+
      '<button data-action="block" data-id="'+c.peer.id+'">拉黑</button><button data-action="report" data-id="'+c.peer.id+'">举报</button></div></article>').join("")
    :empty("还没有好友","前往「发现同频」，找到共同收藏的伙伴。");
  $("blocked-list").innerHTML=state.blocked.length?state.blocked.map(x=>'<p>@'+escapeHtml(x.handle)+' <button class="button button-soft" data-action="unblock" data-id="'+x.id+'">解除拉黑</button></p>').join(""):"暂无";
}
function renderChat() {
  $("chat-panel").hidden=!state.chatPeer;
  if(!state.chatPeer)return;
  $("chat-heading").textContent="与 "+state.chatPeer.name+" 的对话";
  $("chat-list").innerHTML=state.chatMessages.map(m=>
    '<div class="chat-item'+(m.from===state.user?.id?" mine":"")+'">'+escapeHtml(m.text)+
    '<small>'+escapeHtml(new Date(m.createdAt).toLocaleString("zh-CN"))+'</small></div>').join("");
  $("chat-list").scrollTop=$("chat-list").scrollHeight;
}
async function refreshPeople() {
  if(!state.user){state.people=[];renderPeople();return;}
  try {state.people=(await api("/people")).people;}catch(e){notify(e.message,true);}
  renderPeople();
}
async function refreshConnections() {
  if(!state.user){state.connections=[];state.blocked=[];renderConnections();return;}
  try {
    const response=await api("/connections");
    state.connections=response.connections;
    state.blocked=response.blocked||[];
  }catch(e){notify(e.message,true);}
  renderConnections();
}
async function updateShowcaseDraft(bvid) {
  const pos=state.showcase.findIndex(x=>x.bvid===bvid);
  if(pos>=0)state.showcase.splice(pos,1);
  else {
    if(state.showcase.length>=MAX_SHOWCASE)throw new Error("精选收藏最多 20 条");
    const item=state.items.find(x=>x.bvid===bvid);
    if(!item)throw new Error("本地视频不存在");
    state.showcase.push({bvid:item.bvid,title:item.title,tags:(item.tags||[]).slice(0,5),caption:""});
  }
  await saveShowcase();
  renderLocal();
}
async function persistVideo(input) {
  const bvid=bvidOf(input.bvid);
  if(!bvid)throw new Error("需要有效的 BV 号或视频链接");
  const title=String(input.title||"").trim().slice(0,150);
  if(!title)throw new Error("请填写视频标题");
  const previous=state.items.find(x=>x.bvid===bvid);
  await txPutMany("videos",[{
    ...previous,bvid,title,author:previous?.author||"",
    tags:cleanTopics(input.tags,12),notes:String(input.notes||"").slice(0,4000),
    sourceFolders:previous?.sourceFolders||[],url:"https://www.bilibili.com/video/"+bvid,
    updatedAt:new Date().toISOString()
  }]);
  await refreshLocal();
}
async function importFile(file) {
  if (file.size>20_000_000) throw new Error("导入文件超过 20MB 限制");
  await importPayload(JSON.parse(await file.text()));
}
async function importPayload(parsed) {
  const {items,rejected,duplicates,topics,showcaseDraft,metadataOnly,warnings}=normalizeImported(parsed);
  if(!items.length)throw new Error("未识别到有效 BV 视频，请导入 BFC 的 JSON 备份");
  const previous=new Map(state.items.map(i=>[i.bvid,i]));
  const merged=items.map(item=>{
    const old=previous.get(item.bvid);
    return old?{
      ...old,title:old.metadataMissing&&!item.metadataMissing?item.title:old.title,
      metadataMissing:Boolean(old.metadataMissing&&item.metadataMissing),
      watched:Boolean(old.watched||item.watched),progress:old.progress??item.progress,
      topics:[...new Set([...(old.topics||[]),...(item.topics||[])])].slice(0,12),
      notes:old.notes||item.notes,
      tags:[...new Set([...(old.tags||[]),...(item.tags||[])])].slice(0,12),
      sourceFolders:[...new Set([...(old.sourceFolders||[]),...(item.sourceFolders||[])])].slice(0,30),
      updatedAt:new Date().toISOString()
    }:{...item,updatedAt:new Date().toISOString()};
  });
  await txPutMany("videos",merged);
  if(topics.length){
    const current=(await txGet("settings","topics"))?.value || [];
    const byName=new Map([...current,...topics].map(t=>[t.name,t]));
    await txPutMany("settings",[{key:"topics",value:[...byName.values()].slice(0,100)}]);
  }
  if(showcaseDraft && confirm("此文件包含精选橱窗草稿，要恢复这些草稿吗？这不会自动公开。")){
    state.showcase=showcaseDraft;
    await saveShowcase();
  }
  await refreshLocal();
  notify("仅在本机导入 "+items.length+" 条；文件内重复 "+duplicates+" 条，跳过 "+rejected+" 条。"+
    (metadataOnly?" "+metadataOnly+" 条缺少完整视频标题。":"")+(warnings[0]||""));
}
function exportLocal() {
  const data={type:"tongpin_private_library",version:2,exportedAt:new Date().toISOString(),
    videos:state.items,showcaseDraft:state.showcase,topics:state.topics};
  const content=JSON.stringify(data,null,2);
  if (window.TongpinNative?.postMessage) {
    try {
      window.TongpinNative.postMessage(JSON.stringify({type:"export",content}));
      notify("请选择保存位置，将私人备份保存到你的 Android 设备。");
      return;
    }catch(error){notify("设备备份桥接不可用："+error.message,true);}
  }
  const blob=new Blob([content],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="tongpin-private-backup-"+new Date().toISOString().slice(0,10)+".json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function actionHandler(event) {
  const button=event.target.closest("button[data-action]");
  if(!button)return;
  const {action,id}=button.dataset;
  try {
    if(action==="toggle")return await updateShowcaseDraft(id);
    if(action==="watched"){
      const item=state.items.find(x=>x.bvid===id);
      if(!item)return;
      await txPutMany("videos",[{...item,watched:!item.watched,updatedAt:new Date().toISOString()}]);
      await refreshLocal();
      return;
    }
    if(action==="remove"){
      if(!confirm("只删除本浏览器的私人视频记录？不会取消 B站收藏。"))return;
      await txDelete("videos",id);
      await refreshLocal();
      return;
    }
    if(action==="edit"){
      const item=state.items.find(i=>i.bvid===id);
      if(!item)return;
      const form=$("add-form");
      form.elements.bvid.value=item.bvid;
      form.elements.title.value=item.title;
      form.elements.tags.value=(item.tags||[]).join(", ");
      form.elements.notes.value=item.notes||"";
      $("add-dialog").showModal();
      return;
    }
    if(!state.user){setTab("account");notify("请先创建账户或登录才能交友。");return;}
    if(action==="request"){
      await api("/connections","POST",{targetId:id});notify("已发送交友申请。");await refreshPeople();
    }else if(action==="accept"||action==="decline"){
      await api("/connections/"+id,"PUT",{action});notify("已处理申请。");await refreshConnections();
    }else if(action==="chat"){
      state.chatPeer={id,name:button.dataset.name};
      state.chatMessages=(await api("/messages?peer="+encodeURIComponent(id))).messages;
      renderChat();
    }else if(action==="block"){
      if(!confirm("确认拉黑？你们将不能继续匹配或聊天，已有好友关系会解除。"))return;
      await api("/blocks","POST",{targetId:id});notify("已拉黑。");state.chatPeer=null;renderChat();await refreshConnections();await refreshPeople();
    }else if(action==="unfriend"){
      if(!confirm("确认解除好友关系？"))return;
      await api("/connections/"+id,"DELETE",{});
      state.chatPeer=null;renderChat();await refreshConnections();notify("已解除好友关系。");
    }else if(action==="unblock"){
      await api("/blocks/"+id,"DELETE",{});notify("已解除拉黑。");await refreshConnections();
    }else if(action==="report"){
      state.reportTarget=id;
      $("report-form").reset();
      $("report-dialog").showModal();
    }
  }catch(e){notify(e.message,true);}
}
function wire() {
  $("nav").addEventListener("click",e=>{const button=e.target.closest("button[data-tab]");if(button)setTab(button.dataset.tab);});
  $("login-shortcut").onclick=()=>setTab("account");
  $("import-trigger").onclick=()=>$("import-file").click();
  $("import-bfc-local").onclick=async()=>{
    const button=$("import-bfc-local");
    if(!confirm("从本机 127.0.0.1:4198 读取你已有的 BFC 收藏备份并导入当前浏览器？不会访问 B站，也不会上传到社交服务。"))return;
    button.disabled=true;
    try{
      const res=await fetch("/api/local/bfc-import",{method:"POST",
        headers:{"X-Tongpin-Request":"1","Origin":location.origin},cache:"no-store"});
      const data=await res.json();
      if(!res.ok)throw Error(data.detail ? "本机 BFC 不可用："+data.detail : "请启动本机 BFC 工作台服务（默认4198）。");
      await importPayload(data);
    }catch(e){notify(e.message,true);}
    finally{button.disabled=false;}
  };
  if(!["127.0.0.1","localhost"].includes(location.hostname)){
    $("import-bfc-local").hidden=true;
    $("local-bridge-status").textContent="当前是远程或移动端模式：请选择本地 JSON 备份手动导入，绝不远程访问你的 BFC 私人服务。";
  }
  $("export-trigger").onclick=exportLocal;
  $("import-file").onchange=async e=>{
    try{const file=e.target.files[0];if(file)await importFile(file);}catch(err){notify(err.message,true);}
    e.target.value="";
  };
  $("library-search").oninput=()=>{state.page=1;renderLocal();};
  $("library-tag").onchange=()=>{state.page=1;renderLocal();};
  $("page-prev").onclick=()=>{state.page--;renderLocal();};
  $("page-next").onclick=()=>{state.page++;renderLocal();};
  $("add-trigger").onclick=()=>{$("add-form").reset();$("add-dialog").showModal();};
  $("cancel-add").onclick=()=>$("add-dialog").close();
  $("add-form").onsubmit=async e=>{
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    try {
      await persistVideo({bvid:form.get("bvid"),title:form.get("title"),tags:form.get("tags"),notes:form.get("notes")});
      $("add-dialog").close();notify("私人收藏已保存到本浏览器。");
    }catch(err){notify(err.message,true);}
  };
  document.body.addEventListener("click",actionHandler);
  $("unpublish-showcase").onclick=async()=>{
    if(!state.user){setTab("account");return;}
    if(!confirm("确认撤下服务端全部公开收藏？本机橱窗草稿会保留，方便日后重新发布。"))return;
    try{state.user=(await api("/showcase","PUT",{items:[]})).user;
      renderAuth();renderLocal();notify("已撤下所有公开收藏并关闭可发现性。");}
    catch(e){notify(e.message,true);}
  };
  $("publish-showcase").onclick=async()=>{
    if(!state.user){setTab("account");notify("请先登录，之后再发布精选收藏。");return;}
    if(!confirm("确认公开当前 "+state.showcase.length+" 条精选视频的标题、BV 号和标签？私人笔记不会上传。"))return;
    try{state.user=(await api("/showcase","PUT",{items:state.showcase})).user;renderAuth();renderLocal();notify("精选收藏已发布。公开资料的发现开关仍由你单独控制。");}
    catch(e){notify(e.message,true);}
  };
  $("refresh-people").onclick=refreshPeople;
  $("refresh-friends").onclick=refreshConnections;
  $("auth-mode-register").onclick=()=>{state.authMode="register";renderAuthMode();};
  $("auth-mode-login").onclick=()=>{state.authMode="login";renderAuthMode();};
  $("auth-form").onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const values=new FormData(form);
    const body={handle:values.get("handle"),password:values.get("password")};
    if(state.authMode==="register"){
      body.displayName=values.get("displayName");
      body.inviteCode=values.get("inviteCode");
      body.adult=values.get("adult")==="on";
      body.acceptTerms=body.adult;
    }
    try {
      state.user=(await api(state.authMode==="register"?"/register":"/login","POST",body)).user;
      renderAuth();renderLocal();setTab("account");notify("账户已登录。你的私人收藏仍只留在浏览器。");
      form.reset();
    }catch(e){notify(e.message,true);}
  };
  $("profile-form").onsubmit=async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    try {
      const data={displayName:form.get("displayName"),bio:form.get("bio"),topics:cleanTopics(form.get("topics"),12),
        city:form.get("city"),discoverable:form.get("discoverable")==="on"};
      state.user=(await api("/me","PUT",data)).user;
      renderAuth();notify("公开资料已更新。");
    }catch(e){notify(e.message,true);}
  };
  $("export-social").onclick=async()=>{
    try{
      const response=await fetch("/api/social/account/export",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw Error("账户数据导出失败："+response.status);
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download="tongpin-social-account-"+new Date().toISOString().slice(0,10)+".json";
      a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify("社交账户数据已导出。请妥善保管，其中包含消息和公开资料。");
    }catch(e){notify(e.message,true);}
  };
  $("password-form").onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,values=new FormData(form);
    try{
      await api("/account/password","PUT",{
        currentPassword:values.get("currentPassword"),
        newPassword:values.get("newPassword")
      });
      form.reset();
      await loadSession();
      notify("密码已修改，其他设备会话已退出。请妥善保管新密码。");
    }catch(e){notify(e.message,true);}
  };
  $("logout").onclick=async()=>{
    try {await api("/logout","POST",{});state.user=null;state.people=[];state.connections=[];state.chatPeer=null;
      renderAuth();renderLocal();setTab("library");notify("已退出。私人收藏仍留在当前浏览器。");}
    catch(e){notify(e.message,true);}
  };
  $("delete-account").onclick=async()=>{
    if(!confirm("将永久删除社交账号、公开橱窗、好友和消息。此操作不删除浏览器私人收藏。确定继续？"))return;
    const password=prompt("输入账号密码以确认永久删除：");
    if(password===null)return;
    try {await api("/account","DELETE",{password});state.user=null;state.chatPeer=null;renderAuth();renderLocal();setTab("library");notify("社交账户已删除。私人收藏仍在本浏览器。");}
    catch(e){notify(e.message,true);}
  };
  $("cancel-report").onclick=()=>{$("report-dialog").close();state.reportTarget=null;};
  $("report-form").onsubmit=async event=>{
    event.preventDefault();
    if(!state.reportTarget)return;
    const fields=new FormData(event.currentTarget);
    try{
      await api("/reports","POST",{targetId:state.reportTarget,
        reason:fields.get("reason"),details:fields.get("details")});
      $("report-dialog").close();state.reportTarget=null;
      notify("举报已提交审核。你也可以直接拉黑对方。");
    }catch(e){notify(e.message,true);}
  };
  $("close-chat").onclick=()=>{state.chatPeer=null;renderChat();};
  $("chat-form").onsubmit=async event=>{
    event.preventDefault();
    if(!state.chatPeer)return;
    const text=$("chat-text").value.trim();
    if(!text)return;
    try {
      await api("/messages","POST",{peerId:state.chatPeer.id,text});
      $("chat-text").value="";
      state.chatMessages=(await api("/messages?peer="+encodeURIComponent(state.chatPeer.id))).messages;
      renderChat();
    }catch(e){notify(e.message,true);}
  };
}
async function init() {
  wire();
  renderAuthMode();
  try {db=await openLocal();await refreshLocal();}
  catch(e){notify(errors.local_storage_unavailable,true);$("import-trigger").disabled=true;$("add-trigger").disabled=true;return;}
  await loadSession();
  // Foreground only: periodic inbox/message refresh is a fallback, not push notifications.
  window.setInterval(async()=>{
    if(!state.user || document.visibilityState!=="visible")return;
    if(state.tab==="friends"){
      await refreshConnections();
      if(state.chatPeer){
        try{state.chatMessages=(await api("/messages?peer="+encodeURIComponent(state.chatPeer.id))).messages;renderChat();}
        catch{/* Friendship may have been revoked: next user action displays the error. */}
      }
    }
  },10000);
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/tongpin/sw.js",{scope:"/tongpin/"}).catch(()=>{});
  }
}
init();