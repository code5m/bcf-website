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
  chatPeer: null, chatMessages: [], topics: [], tab: "library", page: 1, authMode: "register", localReady:false, reportTarget:null,
  studyTarget:null,studyPlans:[],sessionEpoch:0,unread:0,appeals:[],messageCursor:null
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
function atomicLocalImport(items, topics, draft) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(["videos","settings"],"readwrite");
    const videos=tx.objectStore("videos"), settings=tx.objectStore("settings");
    const priorRows=videos.getAll(),priorTopics=settings.get("topics"),priorDraft=settings.get("showcase");
    let launched=false;
    function schedule(){
      if(launched || priorRows.readyState!=="done" || priorTopics.readyState!=="done" || priorDraft.readyState!=="done")return;
      launched=true;
      try{
        const oldItems=priorRows.result;
        const oldTopics=priorTopics.result?.value || [];
        const oldShowcase=priorDraft.result?.value || [];
        const previous=new Map(oldItems.map(item=>[item.bvid,item]));
        const now=new Date().toISOString();
        for(const item of items){
          const old=previous.get(item.bvid);
          const newer=old?{
            ...old,title:old.metadataMissing&&!item.metadataMissing?item.title:old.title,
            metadataMissing:Boolean(old.metadataMissing&&item.metadataMissing),
            watched:Boolean(old.watched||item.watched),progress:old.progress??item.progress,
            topics:[...new Set([...(old.topics||[]),...(item.topics||[])])].slice(0,12),
            notes:old.notes||item.notes,
            tags:[...new Set([...(old.tags||[]),...(item.tags||[])])].slice(0,12),
            sourceFolders:[...new Set([...(old.sourceFolders||[]),...(item.sourceFolders||[])])].slice(0,30),
            updatedAt:now
          }:{...item,updatedAt:now};
          videos.put(newer);
        }
        const byName=new Map(oldTopics.map(t=>[t.name,t]));
        for(const incoming of topics){
          const existing=byName.get(incoming.name);
          if(!existing){byName.set(incoming.name,incoming);continue;}
          byName.set(incoming.name,{
            ...incoming,...existing,name:existing.name,
            description:existing.description||incoming.description,
            notes:existing.notes||incoming.notes,
            chapters:[...new Set([...(existing.chapters||[]),...(incoming.chapters||[])])],
            items:[...new Set([...(existing.items||[]),...(incoming.items||[])])],
            sections:{...(incoming.sections||{}),...(existing.sections||{})}
          });
        }
        if(byName.size>100)throw Error("专题超过100个，请拆分备份再导入");
        settings.put({key:"lastImportUndo",value:{videos:oldItems,topics:oldTopics,showcase:oldShowcase}});
        settings.put({key:"topics",value:[...byName.values()]});
        if(draft!==null)settings.put({key:"showcase",value:draft});
      }catch(error){tx.abort();reject(error);}
    }
    for(const request of [priorRows,priorTopics,priorDraft]) request.onsuccess=schedule;
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error("import_aborted"));
  });
}
function restoreLastImport(){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(["videos","settings"],"readwrite");
    const videos=tx.objectStore("videos"), settings=tx.objectStore("settings");
    const prior=settings.get("lastImportUndo");
    prior.onsuccess=()=>{
      if(!prior.result?.value){tx.abort();reject(new Error("没有可恢复的导入记录"));return;}
      const {videos:oldVideos,topics,showcase}=prior.result.value;
      videos.clear();
      for(const item of oldVideos)videos.put(item);
      settings.put({key:"topics",value:topics});
      settings.put({key:"showcase",value:showcase});
      settings.delete("lastImportUndo");
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
function clearPrivateLibrary(){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(["videos","settings"],"readwrite");
    tx.objectStore("videos").clear();
    tx.objectStore("settings").delete("topics");
    tx.objectStore("settings").delete("showcase");
    tx.objectStore("settings").delete("lastImportUndo");
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
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
async function loadSession(){
  const previous=state.user?.id;
  let session=null;
  try{session=(await api("/session")).user;}catch{}
  if(previous!==session?.id)clearSocialSession();
  state.user=session;
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
  if(tab==="learning"){renderLearning();refreshStudyPlans();}
  if(tab==="discover")refreshPeople();
  if(tab==="friends")refreshConnections();
  if(tab==="showcase")renderShowcase();
  if(tab==="account")refreshAppeals();
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
      (selected.length?'<div class="topic-videos">'+
        (topic.notes?'<p class="small-copy">专题笔记：'+escapeHtml(topic.notes.slice(0,240))+'</p>':"")+
        (Array.isArray(topic.chapters)&&topic.chapters.length?'<p class="small-copy">章节：'+topic.chapters.map(escapeHtml).join(" · ")+'</p>':"")+
        selected.slice(0,12).map(v=>'<div class="topic-video">'+
        '<button type="button" data-action="watched" data-id="'+v.bvid+'" class="watched-toggle" aria-pressed="'+Boolean(v.watched)+'">'+(v.watched?"✓ 已学":"○ 待学")+'</button>'+
        '<div><small class="topic-chapter">'+escapeHtml((topic.sections||{})[v.bvid] || "未分章节")+'</small>'+
        '<a href="'+v.url+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(v.title)+'</a></div></div>').join("")+
        (selected.length>12?'<details class="topic-overflow"><summary>展开剩余 '+(selected.length-12)+' 条视频</summary>'+
        selected.slice(12).map(v=>'<div class="topic-video"><button data-action="watched" data-id="'+v.bvid+
          '" class="watched-toggle" aria-pressed="'+Boolean(v.watched)+'">'+(v.watched?"✓ 已学":"○ 待学")+
          '</button><a href="'+v.url+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(v.title)+'</a></div>').join("")+
        '</details>':"")+'</div>':
        '<p>本机尚无此专题的视频元数据，可导入完整 BFC 工作台备份补齐。</p>')+'</article>';
  }).join("");
}


function renderStudyPlans() {
  const target=$("study-plans");
  if(!state.user){target.innerHTML=empty("注册后才能结伴学习","你的私人学习专题可以继续离线使用。");return;}
  if(!state.studyPlans.length){target.innerHTML=empty("还没有共学计划","到「好友与消息」里向已同意交友的朋友发起一个学习邀请。");return;}
  target.innerHTML=state.studyPlans.map(plan=>{
    const total=plan.goals.length,mine=plan.mine.length,theirs=plan.theirs.length;
    const avatar=escapeHtml(plan.peer?.displayName || "好友");
    const goals=plan.goals.map((goal,index)=>{
      const complete=plan.mine.includes(index),partner=plan.theirs.includes(index);
      return '<div class="study-goal"><button data-action="study-toggle" data-id="'+plan.id+
        '" data-index="'+index+'" aria-pressed="'+Boolean(complete)+'"'+
        (plan.status!=="active"?" disabled":"")+'>'+(complete?"✓ 我已完成":"○ 标记完成")+'</button><span>'+
        escapeHtml(goal)+'</span><small>'+(partner?"对方已完成":"对方尚未完成")+'</small></div>';
    }).join("");
    return '<article class="topic-card study-card"><div class="topic-heading"><div><span class="overline">'+
      (plan.status==="active"?"共同进行中":plan.incoming?"等你同意":"等待好友同意")+
      '</span><h4>'+escapeHtml(plan.topic)+'</h4></div><span class="progress-number">'+mine+'/'+total+'</span></div>'+
      '<p>与 '+avatar+' 一起学习 · 你完成 '+mine+' 项，对方完成 '+theirs+' 项</p>'+
      '<div class="progress-track"><span style="width:'+(total?Math.round(mine/total*100):0)+'%"></span></div>'+
      '<div class="study-goals">'+goals+'</div><div class="card-actions">'+
      (plan.incoming?'<button class="highlight" data-action="study-accept" data-id="'+plan.id+'">同意共学</button>'+
        '<button data-action="study-decline" data-id="'+plan.id+'">拒绝</button>':"")+
      '<button data-action="study-cancel" data-id="'+plan.id+'">结束计划</button></div></article>';
  }).join("");
}
async function refreshStudyPlans(){
  if(!state.user){state.studyPlans=[];renderStudyPlans();return;}
  const epoch=state.sessionEpoch,owner=state.user.id;
  try{const plans=(await api("/study/plans")).plans;
    if(epoch===state.sessionEpoch && state.user?.id===owner)state.studyPlans=plans;
  }catch(error){state.studyPlans=[];notify(error.message,true);}
  renderStudyPlans();
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
async function refreshAppeals(){
  if(!state.user)return;
  try{
    const result=await api("/appeals");
    $("appeal-history").textContent=result.appeals.map(a=>
      a.createdAt+" · "+a.status+" · "+(a.resolution||"尚无审核结论")).join("\n")||"暂无申诉";
  }catch{$("appeal-history").textContent="申诉暂时无法读取";}
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
      (c.status==="accepted"?'<button class="highlight" data-action="chat" data-id="'+c.peer.id+'" data-name="'+escapeHtml(c.peer.displayName)+'">聊天</button>'+
      '<button data-action="study" data-id="'+c.peer.id+'" data-name="'+escapeHtml(c.peer.displayName)+'">结伴学习</button>'+
      '<button data-action="unfriend" data-id="'+c.id+'">解除好友</button>':"")+
      '<button data-action="block" data-id="'+c.peer.id+'">拉黑</button><button data-action="report" data-id="'+c.peer.id+'">举报</button></div></article>').join("")
    :empty("还没有好友","前往「发现同频」，找到共同收藏的伙伴。");
  $("blocked-list").innerHTML=state.blocked.length?state.blocked.map(x=>'<p>@'+escapeHtml(x.handle)+' <button class="button button-soft" data-action="unblock" data-id="'+x.id+'">解除拉黑</button></p>').join(""):"暂无";
}
function clearSocialSession(){
  state.sessionEpoch++;
  state.user=null;state.people=[];state.connections=[];state.blocked=[];
  state.chatPeer=null;state.chatMessages=[];state.studyTarget=null;
  state.studyPlans=[];state.reportTarget=null;state.unread=0;state.appeals=[];
  state.messageCursor=null;
  if($("unread-count"))$("unread-count").hidden=true;
  if($("load-older"))$("load-older").hidden=true;
  if($("recovery-codes-output"))$("recovery-codes-output").textContent="";
  if($("chat-panel")){renderChat();}
  if($("discover-list"))renderPeople();
  if($("friends-list"))renderConnections();
  if($("study-plans"))renderStudyPlans();
}
function renderChat() {
  $("chat-panel").hidden=!state.chatPeer;
  if(!state.chatPeer)return;
  $("chat-heading").textContent="与 "+state.chatPeer.name+" 的对话";
  $("chat-list").innerHTML=state.chatMessages.map(m=>
    '<div class="chat-item'+(m.from===state.user?.id?" mine":"")+'">'+escapeHtml(m.text)+
    '<small>'+escapeHtml(new Date(m.createdAt).toLocaleString("zh-CN"))+'</small></div>').join("");
  $("load-older").hidden=!state.messageCursor;
  $("chat-list").scrollTop=$("chat-list").scrollHeight;
}

async function refreshNotifications(){
  if(!state.user){state.unread=0;$("unread-count").hidden=true;return;}
  const epoch=state.sessionEpoch,owner=state.user.id;
  try{
    const result=await api("/notifications");
    if(epoch!==state.sessionEpoch||state.user?.id!==owner)return;
    state.unread=result.total||0;
    const badge=$("unread-count");
    badge.hidden=!state.unread;
    badge.textContent=state.unread>99?"99+":String(state.unread);
  }catch{}
}
async function openChat(peer){
  state.chatPeer=peer;
  const owner=state.user?.id,epoch=state.sessionEpoch;
  const result=await api("/messages?peer="+encodeURIComponent(peer.id));
  if(owner!==state.user?.id||epoch!==state.sessionEpoch)return;
  state.chatMessages=result.messages;
  state.messageCursor=result.nextCursor||null;
  renderChat();
  await api("/messages/read","POST",{peerId:peer.id});
  await refreshNotifications();
}
async function refreshPeople() {
  if(!state.user){state.people=[];renderPeople();return;}
  const epoch=state.sessionEpoch,owner=state.user.id;
  try {const people=(await api("/people")).people;
    if(epoch===state.sessionEpoch&&state.user?.id===owner)state.people=people;
  }catch(e){state.people=[];notify(e.message,true);}
  renderPeople();
}
async function refreshConnections() {
  if(!state.user){state.connections=[];state.blocked=[];renderConnections();return;}
  const epoch=state.sessionEpoch,owner=state.user.id;
  try {
    const response=await api("/connections");
    if(epoch===state.sessionEpoch&&state.user?.id===owner){
      state.connections=response.connections;
      state.blocked=response.blocked||[];
    }
  }catch(e){state.connections=[];state.blocked=[];notify(e.message,true);}
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
    ...previous,bvid,title,metadataMissing:false,author:previous?.author||"",
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
  const conflicts=topics.filter(t=>state.topics.some(old=>old.name===t.name)).length;
  const restoreDraft=showcaseDraft && confirm("备份包含精选橱窗草稿，恢复到本机吗？不会自动公开。");
  const yes=confirm("准备在本机导入 "+items.length+" 条视频、"+topics.length+" 个专题。"+
    (conflicts?"其中 "+conflicts+" 个同名专题会保留现有笔记与顺序并合并新内容。":"")+
    "导入前会保存一个可撤销快照。确认继续？");
  if(!yes)return;
  await atomicLocalImport(items,topics,restoreDraft?showcaseDraft:null);
  await refreshLocal();
  notify("安全导入成功："+items.length+" 条视频、"+topics.length+" 个专题；"+
    "重复 "+duplicates+"、跳过 "+rejected+"；"+(metadataOnly?"缺标题 "+metadataOnly+"。":"")+
    (warnings[0]||"")+" 可点击「撤销上次导入」回滚。");
}
function exportLocal() {
  const data={type:"tongpin_private_library",version:3,exportedAt:new Date().toISOString(),
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
      const published=(state.user?.showcase||[]).some(item=>item.bvid===id);
      if(published && !confirm("该视频还在服务器公开橱窗。删除本地记录前必须先从公开橱窗撤下。是否现在一并撤下？"))return;
      if(!confirm("确认删除该视频的本地记录与橱窗草稿？此操作不修改 B站上的收藏。"))return;
      if(published){
        const next=state.user.showcase.filter(item=>item.bvid!==id);
        state.user=(await api("/showcase","PUT",{items:next})).user;
        renderAuth();
      }
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(["videos","settings"],"readwrite");
        const settings=tx.objectStore("settings");
        tx.objectStore("videos").delete(id);
        const localDraft=state.showcase.filter(item=>item.bvid!==id);
        settings.put({key:"showcase",value:localDraft});
        const topics=state.topics.map(topic=>({
          ...topic,items:(topic.items||[]).filter(bvid=>bvid!==id),
          sections:Object.fromEntries(Object.entries(topic.sections||{}).filter(([bvid])=>bvid!==id))
        }));
        settings.put({key:"topics",value:topics});
        // A deliberate user deletion wins over any older import-undo snapshot.
        // Otherwise "undo" could silently resurrect records and private notes.
        settings.delete("lastImportUndo");
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      await refreshLocal();
      notify(published?"已从服务器公开橱窗撤下，并删除本地记录。":"已删除本地记录和草稿。");
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
    if(action==="study"){
      state.studyTarget={id,name:button.dataset.name};
      $("study-form").reset();
      $("study-dialog-title").textContent="邀请 "+state.studyTarget.name+" 一起学习";
      $("study-dialog").showModal();
    }else if(action==="study-accept" || action==="study-decline" || action==="study-cancel" ||
      action==="study-toggle"){
      if(action==="study-cancel" && !confirm("确认结束这个共学计划吗？"))return;
      const decision=action==="study-toggle"?"toggle":action.replace("study-","");
      await api("/study/plans/"+id,"PUT",{action:decision,
        ...(decision==="toggle"?{goalIndex:Number(button.dataset.index)}:{})});
      await refreshStudyPlans();
      notify(decision==="toggle"?"已更新你的共学进度。":"共学计划状态已更新。");
    }else if(action==="request"){
      await api("/connections","POST",{targetId:id});notify("已发送交友申请。");await refreshPeople();
    }else if(action==="accept"||action==="decline"){
      await api("/connections/"+id,"PUT",{action});notify("已处理申请。");await refreshConnections();
    }else if(action==="chat"){
      await openChat({id,name:button.dataset.name});
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
  $("undo-import").onclick=async()=>{
    if(!confirm("恢复到上一次导入前的本地收藏快照？导入之后新增的本地修改会一并撤销。"))return;
    try{await restoreLastImport();await refreshLocal();notify("已恢复到上次导入之前。");}
    catch(error){notify(error.message,true);}
  };
  $("clear-private").onclick=async()=>{
    if(!confirm("这将清空当前浏览器里的全部私人收藏、专题、笔记和橱窗草稿；不会删除服务器上的公开橱窗。请先导出备份。"))return;
    if(!confirm("最后确认：永久清除本设备全部私人收藏数据？"))return;
    try{await clearPrivateLibrary();await refreshLocal();notify("本设备私人收藏库已清空。已发布橱窗仍需单独撤下。");}
    catch(error){notify(error.message,true);}
  };
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
      const result=await api(state.authMode==="register"?"/register":"/login","POST",body);
      clearSocialSession();state.user=result.user;
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
      const content=await response.text();
      if(window.TongpinNative?.postMessage){
        window.TongpinNative.postMessage(JSON.stringify({type:"export-social",content}));
        notify("请选择 Android 设备中的保存位置；备份包含私人消息，请谨慎存放。");
        return;
      }
      const blob=new Blob([content],{type:"application/json"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download="tongpin-social-account-"+new Date().toISOString().slice(0,10)+".json";
      a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify("社交账户数据已导出。请妥善保管，其中包含消息和公开资料。");
    }catch(e){notify(e.message,true);}
  };
  $("recovery-codes-form").onsubmit=async event=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    try{
      const response=await api("/account/recovery-codes","POST",{password:fields.get("password")});
      $("recovery-codes-output").textContent=response.codes.join("\n");
      event.currentTarget.reset();
      notify("已生成8个一次性恢复码。请立即在安全位置保存，之后无法再次查看明文。");
    }catch(error){notify(error.message,true);}
  };
  $("recover-form").onsubmit=async event=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    try{
      await api("/account/recover","POST",{handle:fields.get("handle"),code:fields.get("code"),
        newPassword:fields.get("newPassword")});
      event.currentTarget.reset();
      notify("密码已重置，所有既有会话已失效。请重新登录。");
    }catch(error){notify(error.message,true);}
  };
  $("appeal-form").onsubmit=async event=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    try{
      await api("/appeals","POST",{details:fields.get("details")});
      event.currentTarget.reset();
      notify("已提交申诉，等待人工审核。");
      await refreshAppeals();
    }catch(error){notify(error.message,true);}
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
    try {await api("/logout","POST",{});clearSocialSession();
      renderAuth();renderLocal();setTab("library");notify("已退出。私人收藏仍留在当前浏览器。");}
    catch(e){notify(e.message,true);}
  };
  $("delete-account").onclick=async()=>{
    if(!confirm("将永久删除社交账号、公开橱窗、好友和消息。此操作不删除浏览器私人收藏。确定继续？"))return;
    const password=prompt("输入账号密码以确认永久删除：");
    if(password===null)return;
    try {await api("/account","DELETE",{password});clearSocialSession();renderAuth();renderLocal();setTab("library");notify("社交账户已删除。私人收藏仍在本浏览器。");}
    catch(e){notify(e.message,true);}
  };
  $("cancel-study").onclick=()=>{$("study-dialog").close();state.studyTarget=null;};
  $("study-form").onsubmit=async event=>{
    event.preventDefault();
    if(!state.studyTarget)return;
    const data=new FormData(event.currentTarget);
    const goals=String(data.get("goals")||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(goals.length<1||goals.length>5){notify("请填写 1–5 个明确的共同学习目标。",true);return;}
    try{
      await api("/study/plans","POST",{peerId:state.studyTarget.id,
        topic:data.get("topic"),goals});
      $("study-dialog").close();state.studyTarget=null;
      notify("共学邀请已发送，对方同意后才会开始共享进度。");
      setTab("learning");
    }catch(error){notify(error.message,true);}
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
  $("load-older").onclick=async()=>{
    if(!state.chatPeer||!state.messageCursor)return;
    try{
      const result=await api("/messages?peer="+encodeURIComponent(state.chatPeer.id)+
        "&before="+encodeURIComponent(state.messageCursor));
      const seen=new Set(state.chatMessages.map(m=>m.id));
      state.chatMessages=[...result.messages.filter(m=>!seen.has(m.id)),...state.chatMessages];
      state.messageCursor=result.nextCursor||null;
      renderChat();
    }catch(error){notify(error.message,true);}
  };
  $("close-chat").onclick=()=>{state.chatPeer=null;state.chatMessages=[];state.messageCursor=null;renderChat();};
  $("chat-form").onsubmit=async event=>{
    event.preventDefault();
    if(!state.chatPeer)return;
    const text=$("chat-text").value.trim();
    if(!text)return;
    try {
      await api("/messages","POST",{peerId:state.chatPeer.id,text});
      $("chat-text").value="";
      await openChat(state.chatPeer);
    }catch(e){notify(e.message,true);}
  };
}
async function init() {
  wire();
  renderAuthMode();
  try {db=await openLocal();await refreshLocal();}
  catch(e){notify(errors.local_storage_unavailable,true);$("import-trigger").disabled=true;$("add-trigger").disabled=true;return;}
  await loadSession();
  await refreshNotifications();
  // Foreground only: periodic inbox/message refresh is a fallback, not push notifications.
  window.setInterval(async()=>{
    if(!state.user || document.visibilityState!=="visible")return;
    if(state.tab==="learning")await refreshStudyPlans();
    await refreshNotifications();
    if(state.tab==="friends"){
      await refreshConnections();
      if(state.chatPeer){
        try{
          const response=await api("/messages?peer="+encodeURIComponent(state.chatPeer.id));
          const seen=new Set(state.chatMessages.map(m=>m.id));
          state.chatMessages=[...state.chatMessages,...response.messages.filter(m=>!seen.has(m.id))];
          renderChat();
        }
        catch{/* Friendship may have been revoked: next user action displays the error. */}
      }
    }
  },10000);
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/tongpin/sw.js",{scope:"/tongpin/"}).catch(()=>{});
  }
}
init();