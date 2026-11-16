import {bvidOf, cleanTopics, normalizeImported, MAX_SHOWCASE} from "./core.js";

const $ = id => document.getElementById(id);
const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const errors = {
  login_required:"请先登录，私人收藏仍可离线使用。",
  invalid_credentials:"用户名或密码错误。",
  handle_taken:"用户名已被使用，请换一个。",
  invalid_handle_or_password:"用户名需 3–20 位英文/数字/下划线，密码至少 12 位。",
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
  local_storage_unavailable:"浏览器本地存储不可用，请使用支持 IndexedDB 的浏览器。"
};
function notify(text, isError = false) {
  const box = $("notice");
  box.textContent = String(text);
  box.classList.toggle("error", isError);
  box.hidden = false;
}
const state = {
  items: [], showcase: [], user: null, people: [], connections: [], blocked: [],
  chatPeer: null, chatMessages: [], tab: "library", page: 1, authMode: "register"
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
  if(!["library","showcase","discover","friends","account"].includes(tab))tab="library";
  state.tab=tab;
  document.querySelectorAll("[data-tab]").forEach(el=>{
    el.classList.toggle("active",el.dataset.tab===tab);
    el.setAttribute("aria-current",el.dataset.tab===tab?"page":"false");
  });
  document.querySelectorAll(".panel-section").forEach(el=>el.hidden=el.id!=="tab-"+tab);
  $("page-title").textContent=({
    library:"我的收藏",showcase:"收藏橱窗",discover:"发现同频",friends:"好友与消息",account:"账户设置"
  })[tab];
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
}
function renderShowcase() {
  const items=state.showcase;
  $("showcase-list").innerHTML=items.length?items.map(x=>cardHtml(x,"showcase")).join("")
    :empty("公开橱窗还没有草稿","在「我的收藏」里选择你愿意公开的视频。");
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
  $("friends-list").innerHTML=!state.user?empty("请先登录","只有双方同意才能建立联系。"):connections.length?
    connections.map(c=>'<article class="person-card"><div class="person-header"><div class="avatar">'+escapeHtml(c.peer.displayName.slice(0,1))+'</div><div><h4>'+
      escapeHtml(c.peer.displayName)+'</h4><p>@'+escapeHtml(c.peer.handle)+'</p></div></div>'+
      '<p>'+ (c.status==="accepted"?"已成为好友":c.direction==="incoming"?"对方向你发来交友申请":"等待对方接受申请")+'</p><div class="card-actions">'+
      (c.status==="pending"&&c.direction==="incoming"?'<button class="highlight" data-action="accept" data-id="'+c.id+'">同意</button><button data-action="decline" data-id="'+c.id+'">拒绝</button>':"")+
      (c.status==="accepted"?'<button class="highlight" data-action="chat" data-id="'+c.peer.id+'" data-name="'+escapeHtml(c.peer.displayName)+'">聊天</button>':"")+
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
  if(file.size>20_000_000)throw new Error("导入文件超过 20MB 限制");
  const parsed=JSON.parse(await file.text());
  const {items,rejected,duplicates}=normalizeImported(parsed);
  if(!items.length)throw new Error("未识别到有效 BV 视频，请导入 BFC 的 JSON 备份");
  const previous=new Map(state.items.map(i=>[i.bvid,i]));
  const merged=items.map(item=>{
    const old=previous.get(item.bvid);
    return old?{
      ...old,tags:[...new Set([...(old.tags||[]),...(item.tags||[])])].slice(0,12),
      sourceFolders:[...new Set([...(old.sourceFolders||[]),...(item.sourceFolders||[])])].slice(0,30),
      updatedAt:new Date().toISOString()
    }:{...item,updatedAt:new Date().toISOString()};
  });
  await txPutMany("videos",merged);
  await refreshLocal();
  notify("导入完成：识别 "+items.length+" 条，文件内去重 "+duplicates+" 条，跳过 "+rejected+" 条。仅保存到本机。");
}
function exportLocal() {
  const data={type:"tongpin_private_library",version:1,exportedAt:new Date().toISOString(),
    videos:state.items,showcaseDraft:state.showcase};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
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
    }else if(action==="unblock"){
      await api("/blocks/"+id,"DELETE",{});notify("已解除拉黑。");await refreshConnections();
    }else if(action==="report"){
      const reason=prompt("请选择举报原因：harassment（骚扰） / spam（垃圾信息） / privacy（隐私） / other（其他）","spam");
      if(reason===null)return;
      const details=prompt("补充说明（选填，最多 300 字）","")||"";
      await api("/reports","POST",{targetId:id,reason,details});
      notify("举报已记录，等待人工审核；当前版本不提供自动处理承诺。");
    }
  }catch(e){notify(e.message,true);}
}
function wire() {
  $("nav").addEventListener("click",e=>{const button=e.target.closest("button[data-tab]");if(button)setTab(button.dataset.tab);});
  $("login-shortcut").onclick=()=>setTab("account");
  $("import-trigger").onclick=()=>$("import-file").click();
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
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/tongpin/sw.js",{scope:"/tongpin/"}).catch(()=>{});
  }
}
init();