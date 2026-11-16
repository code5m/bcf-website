const $=id=>document.getElementById(id);
let secret="";
const status=text=>{$("status").textContent=text;};
async function call(path,method="GET",body){
 const r=await fetch("/api/social"+path,{
   method,cache:"no-store",
   headers:{"Authorization":"Bearer "+secret,...(method!=="GET"?{"Content-Type":"application/json","X-Tongpin-Request":"1"}:{})},
   body:body===undefined?undefined:JSON.stringify(body)
 });
 const value=await r.json();
 if(!r.ok)throw Error(value.error||"请求失败 "+r.status);
 return value;
}
function add(parent,tag,text){let el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;}
async function refresh(){
 secret=$("secret").value.trim();
 if(secret.length<32){status("请输入正确长度的管理员密钥");return;}
 try{
  const {reports}=await call("/moderation/reports");
  $("reports").replaceChildren();
  for(const item of reports.reverse()){
   const card=document.createElement("article");card.className="person-card";
   add(card,"h3",item.reason+" · "+(item.reviewed?"已审核："+item.resolution:"待审核"));
   add(card,"p","举报人："+item.reporter+" · 被举报："+item.subject);
   add(card,"p","时间："+item.createdAt);
   add(card,"p","说明："+item.details);
   if(!item.reviewed){
    const controls=document.createElement("div");controls.className="card-actions";
    for(const [label,action] of [["确认已审核","review"],["驳回","dismiss"],["停用7天","suspend"]]){
     const btn=add(controls,"button",label);
     btn.onclick=async()=>{
      if(action==="suspend"&&!confirm("确认停用被举报用户7天？"))return;
      try{await call("/moderation/reports/"+encodeURIComponent(item.id),"PUT",{action});await refresh();}
      catch(e){status("审核失败："+e.message);}
     };
    }
    card.append(controls);
   }
   $("reports").append(card);
  }
  status("已读取 "+reports.length+" 条举报。");
 }catch(e){status("无法读取举报："+e.message);}
}
$("refresh").onclick=refresh;
