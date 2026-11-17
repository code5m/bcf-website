/* Tongpin contest walkthrough. All content and people are plainly fictional,
 * kept exclusively in memory. This module makes NO network or storage calls.
 * The real app, its private IndexedDB library and social sessions are untouched. */
const videos=[
  {id:"film",title:"当一束光成为故事",author:"同频原创情境示例",topic:"电影",kind:"CINEMA",style:"film",
    blurb:"从一个镜头开始，练习用光影讲故事。"},
  {id:"ai",title:"30 秒 AI 短片实验",author:"同频原创情境示例",topic:"AI 创作",kind:"AI LAB",style:"ai",
    blurb:"把灵感变成分镜，做一段真正属于自己的创作。"},
  {id:"music",title:"城市耳机里的第一首歌",author:"同频原创情境示例",topic:"音乐",kind:"MUSIC",style:"music",
    blurb:"有人因为一首歌，找到愿意一起创作的人。"},
  {id:"camera",title:"周末街头摄影计划",author:"同频原创情境示例",topic:"摄影",kind:"STREET",style:"camera",
    blurb:"收藏一张光影，让下一次城市漫步有方向。"}
];
const people=[
  {id:"lan",name:"阿岚",handle:"lan_demo",avatar:"岚",category:"电影创作者",
    bio:"喜欢那些没有对白、只靠镜头就能打动人的小故事。",
    published:["film","ai"],topics:["电影","AI 创作","分镜设计"],tone:"rose",
    note:"我们都喜欢电影语言，也都在学着用 AI 把想法变成作品。"},
  {id:"man",name:"小满",handle:"man_demo",avatar:"满",category:"音乐与影像",
    bio:"听歌散步，也喜欢给自己的城市拍一点小小的纪录。",
    published:["ai","music","camera"],topics:["音乐","影像","城市观察"],tone:"mint",
    note:"一条关于 AI 短片的共同收藏，或许是很好的开场白。"}
];
const htmlEscape=v=>String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const movie=id=>videos.find(v=>v.id===id);
const person=id=>people.find(p=>p.id===id);
const uid=id=>htmlEscape(id);
const word=(n,s)=>n>0?n+" "+s:"暂无";
const nav=[["video","play","视频"],["meet","heart","遇见"],["messages","chat","消息"],["mine","user","我的"]];
function icon(name){
  return ({play:"▶",heart:"♡",chat:"✉",user:"◉"})[name]||"✦";
}
function art(v,featured=false){
  return '<div class="tpd-art tpd-art-'+uid(v.style)+(featured?" tpd-art-wide":"")+
    '" aria-label="为演示制作的抽象主题视觉，不是真实视频封面">'+
    '<span class="tpd-art-top">'+htmlEscape(v.kind)+' <i> / SCENE '+String(videos.indexOf(v)+1).padStart(2,"0")+'</i></span>'+
    '<div class="tpd-art-center" aria-hidden="true"><span class="tpd-orbit"></span><span class="tpd-symbol">'+
    ({film:"◒",ai:"✳",music:"♫",camera:"◎"})[v.id]+'</span></div>'+
    '<span class="tpd-art-bottom">原创概念视觉 · 演示内容</span></div>';
}
export function mountDemo(root,{onExit}={}){
  const state={
    tab:"video",selected:new Set(["film","ai","camera"]),activeVideo:"film",
    activePerson:"lan",relation:"none",messages:[],study:false,goals:new Set(),
    sent:false,replyCount:0
  };
  const shared=p=>p.published.filter(id=>state.selected.has(id));
  function top(){
    return '<header class="tpd-top"><a class="tpd-brand" href="/tongpin/?demo=1" aria-label="同频 APP 演示首页">'+
      '<span class="tpd-brand-glyph">◉</span><span>同频 <small>TONGPIN</small></span></a>'+
      '<div class="tpd-top-right"><span class="tpd-mode"><span class="tpd-led"></span>APP 交互演示</span>'+
      '<button class="tpd-exit" data-action="exit" aria-label="退出演示，返回真实 APP">退出演示 ×</button></div></header>';
  }
  function side(){
    return '<aside class="tpd-side"><div class="tpd-side-head"><span class="tpd-kicker">DISCOVER YOUR PEOPLE</span>'+
      '<strong>从收藏出发，<br>遇见同频的人。</strong><p>找到相同兴趣的人，让一句「我也喜欢」成为故事的开始。</p></div>'+
      '<nav class="tpd-side-nav" aria-label="演示主导航">'+nav.map(([tab,ic,name])=>
        '<button class="'+(state.tab===tab?"active":"")+'" data-action="tab" data-tab="'+tab+
        '" aria-current="'+(state.tab===tab?"page":"false")+'"><span>'+icon(ic)+'</span>'+name+'</button>').join("")+
      '</nav><div class="tpd-side-foot">私人收藏不公开，真实 APP 的登录及数据不受演示影响。</div></aside>';
  }
  function bottomNav(){
    return '<nav class="tpd-bottom-nav" aria-label="手机演示导航">'+nav.map(([tab,ic,name])=>
      '<button class="'+(state.tab===tab?"active":"")+'" data-action="tab" data-tab="'+tab+
      '" aria-current="'+(state.tab===tab?"page":"false")+'"><span>'+icon(ic)+'</span><small>'+name+'</small></button>').join("")+'</nav>';
  }
  function path(){
    const phase=state.messages.length?4:state.relation==="accepted"?3:state.relation==="pending"?2:1;
    const steps=["刷到喜欢的视频","发现同一份热爱","双方愿意认识","聊出新的可能"];
    return '<div class="tpd-steps" aria-label="90 秒演示流程">'+steps.map((x,i)=>
      '<div class="'+(i<phase?"done":i===phase?"current":"")+'"><span>'+(i+1)+'</span><small>'+
      htmlEscape(x)+'</small></div>').join("")+'</div>';
  }
  function videoPage(){
    const featured=movie(state.activeVideo);
    return '<section class="tpd-screen tpd-video-screen"><div class="tpd-page-intro"><div>'+
      '<span class="tpd-kicker">YOUR INTEREST / YOUR STORY</span><h1>喜欢的东西，<br><em>不必只属于自己。</em></h1>'+
      '<p>别人也保存过你喜欢的内容吗？从一条视频开始找答案。</p></div>'+
      '<span class="tpd-count">'+state.selected.size+' <small>份已选演示收藏</small></span></div>'+
      '<div class="tpd-feature">'+art(featured,true)+
      '<div class="tpd-feature-copy"><span class="tpd-pill">本地收藏 · 情境演示</span>'+
      '<h2>'+htmlEscape(featured.title)+'</h2><p>'+htmlEscape(featured.blurb)+'</p>'+
      '<div class="tpd-feature-tags"><span>#'+htmlEscape(featured.topic)+'</span><span>原创示例内容</span></div>'+
      '<div class="tpd-actions"><button class="tpd-primary" data-action="find-video" data-id="'+uid(featured.id)+
      '">看看谁也收藏了 <span>↗</span></button>'+
      '<button class="tpd-outline" data-action="favorite" data-id="'+uid(featured.id)+'" aria-pressed="'+
      state.selected.has(featured.id)+'">'+(state.selected.has(featured.id)?"♥ 已加入我的演示收藏":"♡ 加入演示收藏")+
      '</button></div><small class="tpd-micro">这是原创情境示例，不是 B站真实视频或可播放的视频资源。</small></div></div>'+
      '<div class="tpd-section-title"><div><span class="tpd-kicker">SCROLL SOMETHING MEANINGFUL</span>'+
      '<h3>再看点喜欢的</h3></div><button class="tpd-link" data-action="tab" data-tab="meet">发现同好 ↗</button></div>'+
      '<div class="tpd-video-grid">'+videos.map(v=>
        '<article class="tpd-video-item"><button class="tpd-poster-button" data-action="feature" data-id="'+uid(v.id)+
        '" aria-label="查看示例作品 '+htmlEscape(v.title)+'">'+art(v)+'</button>'+
        '<div class="tpd-video-meta"><small>#'+htmlEscape(v.topic)+'</small>'+
        '<strong>'+htmlEscape(v.title)+'</strong><div><span>模拟内容</span>'+
        '<button data-action="favorite" data-id="'+uid(v.id)+'" aria-label="'+
        (state.selected.has(v.id)?"取消":"加入")+'演示收藏" aria-pressed="'+state.selected.has(v.id)+'">'+
        (state.selected.has(v.id)?"♥":"♡")+'</button></div></div></article>').join("")+'</div></section>';
  }
  function personCard(p){
    const matches=shared(p);
    const lead=matches.map(id=>movie(id)?.title).filter(Boolean);
    return '<article class="tpd-person"><div class="tpd-person-top tpd-tone-'+uid(p.tone)+'">'+
      '<span class="tpd-match-count">✦ '+matches.length+' 条共同收藏</span>'+
      '<div class="tpd-person-av">'+htmlEscape(p.avatar)+'</div>'+
      '<strong>'+htmlEscape(p.name)+'</strong><small>@'+htmlEscape(p.handle)+' · 虚构演示用户</small></div>'+
      '<div class="tpd-person-content"><span class="tpd-field">'+htmlEscape(p.category)+'</span>'+
      '<p>'+htmlEscape(p.bio)+'</p>'+
      '<div class="tpd-matched"><span>你们都收藏了</span><strong>'+
      (lead.length?lead.map(htmlEscape).join(" · "):"当前还没有交集")+'</strong></div>'+
      '<div class="tpd-tagline">'+p.topics.map(tag=>'<span>#'+htmlEscape(tag)+'</span>').join("")+'</div>'+
      '<button class="tpd-outline tpd-person-cta" data-action="select-person" data-id="'+uid(p.id)+
      '">了解这位同好 <span>→</span></button></div></article>';
  }
  function meetPage(){
    const p=person(state.activePerson);
    const matches=shared(p);
    return '<section class="tpd-screen"><div class="tpd-page-intro"><div>'+
      '<span class="tpd-kicker">YOUR PEOPLE, YOUR SIGNAL</span><h1>原来，<em>你也收藏了。</em></h1>'+
      '<p>这不是陌生人的随机推荐，而是从共同热爱的内容开始。</p></div>'+
      '<span class="tpd-count">'+people.filter(p=>shared(p).length).length+' <small>位演示同好</small></span></div>'+
      '<div class="tpd-privacy-line"><span>◈ 本机兴趣交集示意</span><span>真人用户和私人 BV 均未访问或上传</span></div>'+
      '<div class="tpd-people-grid">'+people.map(personCard).join("")+'</div>'+
      '<div class="tpd-match-detail"><div class="tpd-detail-head"><span class="tpd-kicker">WHY YOU TWO?</span>'+
      '<h3>你和 '+htmlEscape(p.name)+' 的共同点</h3><p>'+htmlEscape(p.note)+'</p></div>'+
      '<div class="tpd-common-list">'+(matches.length?matches.map(id=>{
        const v=movie(id);
        return '<div><span class="tpd-common-icon">'+({film:"◒",ai:"✳",music:"♫",camera:"◎"})[id]+'</span>'+
        '<span><small>两个人都收藏的演示内容</small><strong>'+htmlEscape(v.title)+'</strong></span>'+
        '<span class="tpd-common-check">共同喜欢 ✓</span></div>';
      }).join(""):'<p>暂时没有共同收藏。可以返回视频页选择喜欢的内容。</p>')+'</div>'+
      '<div class="tpd-actions">'+(
        state.relation==="none"?
          '<button class="tpd-primary" data-action="request">♡ 申请认识 '+htmlEscape(p.name)+'</button>':
        state.relation==="pending"?
          '<div class="tpd-accept-demo"><strong>申请已经发出（演示）</strong><p>真实 APP 必须等待对方同意，才能聊天。</p>'+
          '<button class="tpd-primary" data-action="accept">模拟对方同意 →</button></div>':
          '<button class="tpd-primary" data-action="tab" data-tab="messages">去和 '+htmlEscape(p.name)+' 聊聊 →</button>'
      )+'</div><p class="tpd-micro">只有对方主动公开的精选才可用于本机对比；真实 APP 不会上传你的私人收藏清单。</p>'+
      '</div></section>';
  }
  function msgBubble(m){
    return '<div class="tpd-chat-row '+(m.from==="me"?"mine":"theirs")+'"><span class="tpd-chat-bubble">'+
      htmlEscape(m.text)+'</span><small>'+((m.from==="me")?"我":"演示回复")+'</small></div>';
  }
  function messagePage(){
    const p=person(state.activePerson);
    if(state.relation!=="accepted"){
      return '<section class="tpd-screen"><div class="tpd-page-intro"><div><span class="tpd-kicker">KEEP IT REAL</span>'+
        '<h1>一段对话，<em>从喜欢开始。</em></h1></div></div><div class="tpd-empty-chat">'+
        '<div class="tpd-large-icon">✉</div><h2>先从一条共同收藏开始吧</h2>'+
        '<p>只有双方都愿意建立联系，聊天才会开启。演示模式可模拟对方接受申请。</p>'+
        '<button class="tpd-primary" data-action="tab" data-tab="meet">去遇见同好 →</button></div></section>';
    }
    return '<section class="tpd-screen"><div class="tpd-page-intro"><div><span class="tpd-kicker">REAL CONVERSATION / DEMO</span>'+
      '<h1>聊点<em>真正喜欢的。</em></h1></div></div>'+
      '<div class="tpd-conversation"><div class="tpd-chat-head"><div class="tpd-chat-avatar">'+htmlEscape(p.avatar)+'</div>'+
      '<div><strong>'+htmlEscape(p.name)+'</strong><small>已经互相同意 · 模拟对话</small></div>'+
      '<span class="tpd-chat-heart">♡</span></div>'+
      '<div class="tpd-chat-body"><div class="tpd-chat-system">以下聊天内容为本机演示，不会发送给真实用户</div>'+
      (state.messages.length?state.messages.map(msgBubble).join(""):'<div class="tpd-chat-blank">'+
        '<span>✦</span><h3>第一句话，你会聊什么？</h3><p>从你们都收藏的那一条视频开始。</p></div>')+
      '</div><div class="tpd-prompts"><button data-action="suggest" data-text="你也喜欢那条讲光影的短片吗？">聊聊共同视频</button>'+
      '<button data-action="suggest" data-text="要不要一起试试制作一段短片？">邀请一起创作</button>'+
      (state.messages.some(m=>m.from==="me")?'<button data-action="reply">模拟对方回复 ↗</button>':"")+
      '</div><form id="tpd-chat-form" class="tpd-chat-form">'+
      '<input name="text" maxlength="400" placeholder="输入你的第一句话…" aria-label="演示聊天输入" required autocomplete="off"/>'+
      '<button type="submit" aria-label="发送演示消息">发送 →</button></form></div>'+
      (state.messages.some(m=>m.from==="me")?
        '<div class="tpd-study"><div><span class="tpd-kicker">CREATE TOGETHER</span>'+
        '<h3>不止聊天，还能一起完成一件事。</h3><p>把共同兴趣变成一次真正的协作。</p></div>'+
        '<button class="tpd-outline" data-action="study">'+(state.study?"收起共学计划":"发起一次共学体验 →")+'</button>'+
        (state.study?'<div class="tpd-goals"><strong>共学计划 · 一起完成 30 秒短片</strong>'+
          ["约定主题与故事","交换分镜灵感","完成并展示一段作品"].map((x,i)=>
            '<button class="'+(state.goals.has(i)?"checked":"")+'" data-action="goal" data-index="'+i+
            '" aria-pressed="'+state.goals.has(i)+'"><span>'+(state.goals.has(i)?"✓":"○")+
            '</span>'+x+'</button>').join("")+'</div>':"")+
        '</div>':"")+'</section>';
  }
  function minePage(){
    return '<section class="tpd-screen"><div class="tpd-page-intro"><div><span class="tpd-kicker">A LIBRARY WITH A STORY</span>'+
      '<h1>你的兴趣，<em>值得被看见。</em></h1><p>真正的关系从选择分享开始；私人收藏永远先属于你。</p></div></div>'+
      '<div class="tpd-profile"><div class="tpd-profile-avatar">我</div><div><span class="tpd-pill">演示资料 · 不是真实账号</span>'+
      '<h2>正在寻找同频的你</h2><p>喜欢电影、AI 创作，也想认识可以一起完成小作品的人。</p>'+
      '<div class="tpd-tagline"><span>#电影</span><span>#AI 创作</span><span>#音乐</span></div></div></div>'+
      '<div class="tpd-metrics"><div><strong>'+state.selected.size+'</strong><span>本机演示收藏</span></div>'+
      '<div><strong>'+people.filter(p=>shared(p).length).length+'</strong><span>共同收藏同好</span></div>'+
      '<div><strong>0</strong><span>真实数据上传</span></div></div>'+
      '<div class="tpd-privacy-card"><strong>这是一段可操作的产品演示，不是真实社交记录。</strong>'+
      '<p>视频、人物、相同收藏和聊天均为明确标注的情境数据；不会访问或修改 BrowserOS 收藏，也不会注册、私信或发布到真实服务器。退出后演示内容全部消失。</p>'+
      '<div class="tpd-actions"><button class="tpd-outline" data-action="reset">重新体验 90 秒故事</button>'+
      '<button class="tpd-primary" data-action="exit">进入真实同频 APP →</button></div></div></section>';
  }
  function render(){
    const panels={video:videoPage,meet:meetPage,messages:messagePage,mine:minePage};
    const title={video:"视频",meet:"遇见",messages:"消息",mine:"我的"}[state.tab];
    root.innerHTML='<div class="tpd-app">'+top()+
      '<div class="tpd-shell">'+side()+'<main class="tpd-main">'+
      '<div class="tpd-main-top"><div><span class="tpd-kicker">AN INTEREST CAN START A STORY</span>'+
      '<span>同频 / '+title+'</span></div><span class="tpd-demo-chip">模拟演示 · 非真实用户</span></div>'+
      path()+panels[state.tab]()+'<footer class="tpd-footer">这是同频 APP 的本地情境演示，不代表真实平台的用户规模或数据。</footer>'+
      '</main></div>'+bottomNav()+'</div>';
  }
  function changeTab(tab){
    if(!["video","meet","messages","mine"].includes(tab))return;
    state.tab=tab;render();window.scrollTo({top:0,behavior:"instant"});
  }
  function onClick(event){
    const button=event.target.closest("button[data-action]");
    if(!button || !root.contains(button))return;
    const act=button.dataset.action,id=button.dataset.id;
    if(act==="exit"){cleanup();onExit?.();return;}
    if(act==="tab"){changeTab(button.dataset.tab);return;}
    if(act==="reset"){
      state.tab="video";state.selected=new Set(["film","ai","camera"]);state.activeVideo="film";
      state.activePerson="lan";state.relation="none";state.messages=[];state.study=false;
      state.goals.clear();state.replyCount=0;render();window.scrollTo(0,0);return;
    }
    if(act==="feature"){if(movie(id)){state.activeVideo=id;render();window.scrollTo(0,0);}return;}
    if(act==="favorite"){
      if(!movie(id))return;
      if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);
      render();return;
    }
    if(act==="find-video"){
      const next=people.find(p=>p.published.includes(id))?.id||"lan";
      if(next!==state.activePerson){
        state.activePerson=next;state.relation="none";state.messages=[];state.study=false;
        state.goals.clear();state.replyCount=0;
      }
      changeTab("meet");return;
    }
    if(act==="select-person"){
      if(!person(id))return;
      if(id!==state.activePerson){
        state.activePerson=id;state.relation="none";state.messages=[];state.study=false;
        state.goals.clear();state.replyCount=0;
      }
      render();
      root.querySelector(".tpd-match-detail")?.scrollIntoView({behavior:"smooth",block:"nearest"});
      return;
    }
    if(act==="request"){
      if(state.relation!=="none")return;
      state.relation="pending";changeTab("meet");return;
    }
    if(act==="accept"){
      if(state.relation!=="pending")return;
      state.relation="accepted";changeTab("messages");return;
    }
    if(act==="suggest"){
      const input=root.querySelector('#tpd-chat-form input');
      if(input){input.value=button.dataset.text||"";input.focus();}return;
    }
    if(act==="reply"){
      if(state.relation!=="accepted"||!state.messages.some(m=>m.from==="me"))return;
      const options=["是的！我也被那个镜头打动了。","好啊，我们可以先从一个小分镜开始。","那我们就约个时间，一起做一段短片吧！"];
      state.messages.push({from:"peer",text:options[state.replyCount++%options.length]});
      render();return;
    }
    if(act==="study"){
      if(state.relation!=="accepted"||!state.messages.some(m=>m.from==="me"))return;
      state.study=!state.study;render();return;
    }
    if(act==="goal"){
      if(!state.study||state.relation!=="accepted")return;
      const i=Number(button.dataset.index);
      if(!Number.isInteger(i)||i<0||i>2)return;
      if(state.goals.has(i))state.goals.delete(i);else state.goals.add(i);
      render();return;
    }
  }
  function onSubmit(event){
    if(event.target.id!=="tpd-chat-form")return;
    event.preventDefault();
    if(state.relation!=="accepted")return;
    const input=event.target.elements.text;
    const message=String(input?.value||"").trim().slice(0,400);
    if(!message)return;
    state.messages.push({from:"me",text:message});
    render();
    root.querySelector(".tpd-chat-body")?.scrollTo(0,100000);
  }
  function cleanup(){
    root.removeEventListener("click",onClick);
    root.removeEventListener("submit",onSubmit);
    root.replaceChildren();
  }
  root.addEventListener("click",onClick);
  root.addEventListener("submit",onSubmit);
  render();
  return cleanup;
}
