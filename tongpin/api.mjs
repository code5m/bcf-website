import {createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual} from "node:crypto";
import {SocialStore} from "./store.mjs";
import {resolve} from "node:path";
import {cleanText, cleanTopics, matchPublic, normalizeShowcase} from "./core.js";

const SESSION_AGE = 7 * 86400 * 1000;
const empty = () => ({version: 1, users: [], sessions: [], connections: [], messages: [], reports: [], invites: [], studyPlans: [], appeals: [], adminAudit: [], readStates: [], recoveryCodes: []});
const sha = value => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const publicProfile = user => ({
  id: user.id, handle: user.handle, displayName: user.profile.displayName,
  bio: user.profile.bio, city: user.profile.city,
  topics: user.profile.topics, discoverable: user.profile.discoverable,
  showcase: user.showcase
});
const ownProfile = user => ({...publicProfile(user), blocked: user.blocked || [], createdAt: user.createdAt, suspendedUntil: user.suspendedUntil || null});
const peersBlocked = (a, b) => (a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id);
function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
function passwordValid(password, stored) {
  const [salt, hex] = String(stored || "").split(":");
  if (!salt || !hex || hex.length !== 128) return false;
  const expected = Buffer.from(hex, "hex");
  return timingSafeEqual(expected, scryptSync(password, salt, expected.length));
}
function cookieToken(req) {
  const part = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("tongpin_session="));
  const token = part ? part.slice("tongpin_session=".length) : "";
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function auth(db, req, {allowSuspended = false} = {}) {
  const token = cookieToken(req);
  const session = token && db.sessions.find(s => s.key === sha(token) && s.expires > Date.now());
  const user = session && db.users.find(u => u.id === session.userId);
  if (!user) fail(401, "login_required");
  if (!allowSuspended && user.suspendedUntil && new Date(user.suspendedUntil).getTime() > Date.now()) fail(403, "account_suspended");
  return user;
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(value));
}
function setCookie(req, token, maxAge = 604800) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return "tongpin_session=" + token + "; Path=/api/social; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + secure;
}
function methodBody(req, max = 100000) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > max) { reject(Object.assign(new Error("payload_too_large"), {status: 413})); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("invalid_json"), {status: 400})); }
    });
    req.on("error", reject);
  });
}
function writeAllowed(req) {
  if (req.headers["x-tongpin-request"] !== "1") fail(403, "csrf_header_required");
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) fail(415, "json_only");
  let origin;
  try { origin = new URL(String(req.headers.origin || "")); }
  catch { fail(403, "same_origin_required"); }
  if (origin.host !== req.headers.host || !["http:", "https:"].includes(origin.protocol)) fail(403, "same_origin_required");
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") fail(403, "https_required");
}
function byId(db, id) {
  const user = db.users.find(u => u.id === id);
  if (!user) fail(404, "user_not_found");
  return user;
}
function connection(db, a, b) {
  return db.connections.find(c =>
    (c.from === a && c.to === b || c.from === b && c.to === a) && ["pending", "accepted"].includes(c.status));
}
function connected(db, a, b) {
  return Boolean(db.connections.find(c => c.status === "accepted" &&
    (c.from === a && c.to === b || c.from === b && c.to === a)));
}
function visiblePeer(db, user, peer) {
  return user.id !== peer.id && !peersBlocked(user, peer) && peer.profile.discoverable && peer.showcase.length > 0 &&
    !(peer.suspendedUntil && new Date(peer.suspendedUntil).getTime()>Date.now());
}
function verifyAdmin(req) {
  const token=process.env.TONGPIN_ADMIN_TOKEN || "";
  const actual=String(req.headers.authorization||"").replace(/^Bearer /,"");
  if(!token || !actual || actual.length!==token.length)fail(403,"admin_access_denied");
  if(!timingSafeEqual(Buffer.from(actual),Buffer.from(token)))fail(403,"admin_access_denied");
}
function connectionPayload(db, relation, ownerId) {
  const peer = byId(db, relation.from === ownerId ? relation.to : relation.from);
  return {id: relation.id, direction: relation.from === ownerId ? "outgoing" : "incoming",
    status: relation.status, createdAt: relation.createdAt, peer: publicProfile(peer)};
}

export function createSocialApi({dataDir = resolve("runtime/social")} = {}) {
  const store = new SocialStore(dataDir,empty);
  let serial = Promise.resolve();
  const rate = new Map();
  async function read() { return store.read({excludeMessages:true}); }
  async function serialized(action){
    const task=serial.then(action);
    serial=task.catch(()=>{});
    return task;
  }
  async function transaction(action) {
    return serialized(async()=>{
      const db=store.begin();
      try {
        const result=await action(db);
        db.sessions=db.sessions.filter(s=>s.expires>Date.now());
        store.commit(db);
        return result;
      }catch(error){store.rollback();throw error;}
    });
  }
  function limit(req, group, max = 30, windowMs = 60000) {
    const remote=String(req.socket.remoteAddress || "local");
    const forwarded=process.env.TONGPIN_TRUST_PROXY === "1" ?
      String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
    const ip=/^[a-fA-F0-9.:]{3,45}$/.test(forwarded) ? forwarded : remote;
    // Keep bounded in long-running, invite-only deployments.
    if(rate.size>3000){
      for(const [key,history] of rate) {
        if(!history.some(x=>x> Date.now()-3600000))rate.delete(key);
        if(rate.size<=2500)break;
      }
    }
    const key = group + ":" + ip;
    const now = Date.now();
    const current = (rate.get(key) || []).filter(x => x > now - windowMs);
    if (current.length >= max) fail(429, "too_many_requests");
    current.push(now);
    rate.set(key, current);
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/social/")) return false;
    const path = url.pathname.slice("/api/social".length);
    const method = req.method;
    try {
      if (method !== "GET") writeAllowed(req);
      if (method === "GET" && path === "/health") return json(res, 200, {ok: true, storage: "server-local", externalBilibiliRequests: 0}), true;
      if (method === "POST" && path === "/register") {
        limit(req, "auth", 10, 600000);
        const input = await methodBody(req);
        const handle = cleanText(input.handle, 30).toLowerCase();
        const password = String(input.password || "");
        if (!/^[a-z0-9_]{3,20}$/.test(handle) || password.length < 12 || password.length > 128) fail(400, "invalid_handle_or_password");
        if (input.adult !== true || input.acceptTerms !== true) fail(400, "adult_and_terms_required");
        const token = randomBytes(32).toString("hex");
        const result = await transaction(db => {
          if (db.users.some(u => u.handle === handle)) fail(409, "handle_taken");
          if (process.env.TONGPIN_INVITE_ONLY === "1") {
            const invite=String(input.inviteCode || "").trim();
            const entry=(db.invites || []).find(i => i.codeHash === sha(invite) &&
                !i.usedAt && i.expiresAt > Date.now());
            if (!entry) fail(403, "invite_code_required");
            entry.usedAt = Date.now();
          }
          const user = {id: randomUUID(), handle, passwordHash: passwordHash(password), createdAt: new Date().toISOString(),
            profile: {displayName: cleanText(input.displayName, 30) || handle, bio: "", topics: [], city: "", discoverable: false},
            showcase: [], blocked: []};
          db.users.push(user);
          db.sessions.push({key: sha(token), userId: user.id, expires: Date.now() + SESSION_AGE});
          return ownProfile(user);
        });
        json(res, 201, {user: result}, {"Set-Cookie": setCookie(req, token)});
        return true;
      }
      if (method === "POST" && path === "/login") {
        limit(req, "auth", 10, 600000);
        const input = await methodBody(req);
        const db = await read();
        const user = db.users.find(u => u.handle === cleanText(input.handle, 30).toLowerCase());
        if (!user || !passwordValid(String(input.password || ""), user.passwordHash)) fail(401, "invalid_credentials");
        if (user.suspendedUntil && new Date(user.suspendedUntil).getTime() > Date.now()) fail(403, "account_suspended");
        const token = randomBytes(32).toString("hex");
        await transaction(fresh => {
          if (!fresh.users.some(u => u.id === user.id)) fail(401, "invalid_credentials");
          fresh.sessions.push({key: sha(token), userId: user.id, expires: Date.now() + SESSION_AGE});
          return true;
        });
        json(res, 200, {user: ownProfile(user)}, {"Set-Cookie": setCookie(req, token)});
        return true;
      }
      if (method === "POST" && path === "/logout") {
        await transaction(db => {
          const token = cookieToken(req);
          if (token) db.sessions = db.sessions.filter(s => s.key !== sha(token));
          return true;
        });
        json(res, 200, {ok: true}, {"Set-Cookie": setCookie(req, "", 0)});
        return true;
      }
      if (method === "GET" && path === "/session") {
        const db = await read();
        let user = null;
        try { user = auth(db, req, {allowSuspended:true}); } catch {}
        json(res, 200, {user: user ? ownProfile(user) : null});
        return true;
      }
      if (method === "POST" && path === "/account/recovery-codes") {
        limit(req,"recovery-code-create",8,3600000);
        const input=await methodBody(req);
        const codes=await transaction(db=>{
          const me=auth(db,req);
          if(!passwordValid(String(input.password||""),me.passwordHash))fail(403,"invalid_password");
          db.recoveryCodes=(db.recoveryCodes||[]).filter(c=>c.userId!==me.id);
          const codes=Array.from({length:8},()=>randomBytes(12).toString("hex"));
          for(const code of codes)db.recoveryCodes.push({id:randomUUID(),userId:me.id,codeHash:sha(code)});
          return codes;
        });
        json(res,201,{codes,notice:"Show once and store offline"});
        return true;
      }
      if (method === "POST" && path === "/account/recover") {
        limit(req,"recovery-use",6,3600000);
        const input=await methodBody(req);
        const password=String(input.newPassword||"");
        const code=String(input.code||"");
        if(password.length<12||password.length>128)fail(400,"invalid_new_password");
        if(!/^[a-f0-9]{24}$/.test(code))fail(403,"invalid_recovery_code");
        await transaction(db=>{
          const user=db.users.find(u=>u.handle===cleanText(input.handle,30).toLowerCase());
          const found=user&&(db.recoveryCodes||[]).find(c=>c.userId===user.id&&c.codeHash===sha(code));
          if(!found)fail(403,"invalid_recovery_code");
          user.passwordHash=passwordHash(password);
          db.sessions=db.sessions.filter(s=>s.userId!==user.id);
          db.recoveryCodes=(db.recoveryCodes||[]).filter(c=>c.userId!==user.id);
          return true;
        });
        json(res,200,{ok:true,reloginRequired:true});
        return true;
      }
      if (method === "POST" && path === "/appeals") {
        limit(req,"appeal-create",3,86400000);
        const input=await methodBody(req);
        const details=cleanText(input.details,1000);
        if(details.length<15)fail(400,"appeal_too_short");
        const id=await transaction(db=>{
          const me=auth(db,req,{allowSuspended:true});
          if((db.appeals||[]).some(a=>a.userId===me.id&&a.status==="pending"))fail(409,"pending_appeal_exists");
          const id=randomUUID();
          db.appeals.push({id,userId:me.id,details,status:"pending",createdAt:new Date().toISOString()});
          return id;
        });
        json(res,201,{id,status:"pending"});
        return true;
      }
      if (method === "GET" && path === "/appeals") {
        const db=await read(),me=auth(db,req,{allowSuspended:true});
        json(res,200,{appeals:db.appeals.filter(a=>a.userId===me.id).map(a=>({
          id:a.id,details:a.details,status:a.status,createdAt:a.createdAt,resolution:a.resolution||null
        }))});
        return true;
      }
      if (method === "GET" && path === "/moderation/appeals") {
        verifyAdmin(req);
        const db=await read();
        json(res,200,{appeals:db.appeals.slice(-200).map(a=>({
          ...a,handle:db.users.find(u=>u.id===a.userId)?.handle||"deleted"
        }))});
        return true;
      }
      if (method === "PUT" && path.startsWith("/moderation/appeals/")) {
        verifyAdmin(req);
        const input=await methodBody(req);
        if(!["accept","reject"].includes(input.action))fail(400,"invalid_appeal_resolution");
        await transaction(db=>{
          const appeal=db.appeals.find(x=>x.id===path.split("/").at(-1)&&x.status==="pending");
          if(!appeal)fail(404,"pending_appeal_not_found");
          appeal.status=input.action==="accept"?"approved":"rejected";
          appeal.resolution=cleanText(input.resolution,300);
          appeal.reviewedAt=new Date().toISOString();
          const user=db.users.find(u=>u.id===appeal.userId);
          if(user&&input.action==="accept")user.suspendedUntil=null;
          db.adminAudit.push({id:randomUUID(),action:"appeal_"+input.action,
            target:appeal.userId,appealId:appeal.id,createdAt:new Date().toISOString()});
          return true;
        });
        json(res,200,{ok:true});
        return true;
      }
      if (method === "GET" && path === "/moderation/audit") {
        verifyAdmin(req);
        const db=await read();
        json(res,200,{audit:db.adminAudit.slice(-200)});
        return true;
      }
      if (method === "PUT" && path === "/account/password") {
        limit(req,"password-change",8,3600000);
        const input=await methodBody(req);
        const current=String(input.currentPassword || "");
        const next=String(input.newPassword || "");
        if(next.length<12 || next.length>128 || next===current) fail(400,"invalid_new_password");
        await transaction(db=>{
          const me=auth(db,req);
          if(!passwordValid(current,me.passwordHash))fail(403,"invalid_password");
          me.passwordHash=passwordHash(next);
          const key=cookieToken(req);
          db.sessions=db.sessions.filter(s=>s.userId!==me.id || key && s.key===sha(key));
          return true;
        });
        json(res,200,{ok:true,otherSessionsRevoked:true});
        return true;
      }
      if (method === "GET" && path === "/account/export") {
        const db=await read(), me=auth(db,req,{allowSuspended:true});
        json(res,200,{
          type:"tongpin_social_account_export",exportedAt:new Date().toISOString(),account:ownProfile(me),
          connections:db.connections.filter(c=>c.from===me.id||c.to===me.id),
          messages:store.messagesForUser(me.id),
          studyPlans:db.studyPlans.filter(p=>p.creatorId===me.id||p.partnerId===me.id),
          appeals:db.appeals.filter(a=>a.userId===me.id),
          readStates:db.readStates.filter(s=>s.userId===me.id),
          reports:db.reports.filter(r=>r.from===me.id)
        },{"Content-Disposition":'attachment; filename="tongpin-social-export.json"'});
        return true;
      }
      if (method === "POST" && path === "/moderation/invites") {
        verifyAdmin(req);
        const input=await methodBody(req);
        const count=Number(input.count);
        if (!Number.isInteger(count) || count < 1 || count > 20) fail(400, "invalid_invite_count");
        const codes=await transaction(db=>{
          db.invites ||= [];
          const items=[];
          for(let i=0;i<count;i++){
            const code=randomBytes(16).toString("hex");
            db.invites.push({codeHash:sha(code),expiresAt:Date.now()+7*86400000,usedAt:null});
            items.push(code);
          }
          return items;
        });
        json(res,201,{codes,expiresInDays:7});
        return true;
      }
      if (method === "GET" && path === "/moderation/reports") {
        verifyAdmin(req);
        const db=await read();
        json(res,200,{reports:db.reports.slice(-200).map(r=>({
          ...r, reporter:db.users.find(u=>u.id===r.from)?.handle||"deleted",
          subject:db.users.find(u=>u.id===r.target)?.handle||"deleted"
        }))});
        return true;
      }
      if (method === "PUT" && path.startsWith("/moderation/reports/")) {
        verifyAdmin(req);
        const input=await methodBody(req);
        const status=await transaction(db=>{
          const r=db.reports.find(x=>x.id===path.slice("/moderation/reports/".length));
          if(!r)fail(404,"report_not_found");
          if(!["dismiss","review","suspend"].includes(input.action))fail(400,"invalid_moderation_action");
          if(r.reviewed)fail(409,"report_already_reviewed");
          r.reviewed=true;r.resolution=input.action;r.reviewedAt=new Date().toISOString();
          db.adminAudit ||= [];
          db.adminAudit.push({id:randomUUID(),action:"report_"+input.action,
            target:r.target,reportId:r.id,createdAt:new Date().toISOString()});
          if(input.action==="suspend"){
            const u=byId(db,r.target);
            u.suspendedUntil=new Date(Date.now()+7*86400000).toISOString();
          }
          return r.resolution;
        });
        json(res,200,{ok:true,resolution:status});
        return true;
      }
      if (method === "DELETE" && path.startsWith("/connections/")) {
        const id=path.split("/")[2];
        await transaction(db=>{
          const me=auth(db,req);
          const relation=db.connections.find(c=>c.id===id&&(c.from===me.id||c.to===me.id));
          if(!relation)fail(404,"relation_not_found");
          db.connections=db.connections.filter(c=>c.id!==id);
          db.studyPlans=(db.studyPlans||[]).filter(p=>!((p.creatorId===relation.from&&p.partnerId===relation.to)||(p.creatorId===relation.to&&p.partnerId===relation.from)));
          db.readStates=(db.readStates||[]).filter(s=>!((s.userId===relation.from&&s.peerId===relation.to)||(s.userId===relation.to&&s.peerId===relation.from)));
          return true;
        });
        json(res,200,{ok:true});
        return true;
      }
      if (method === "PUT" && path === "/me") {
        const input = await methodBody(req);
        const user = await transaction(db => {
          const me = auth(db, req);
          const profile = {
            displayName: cleanText(input.displayName, 30) || me.handle,
            bio: cleanText(input.bio, 280),
            topics: cleanTopics(input.topics, 12),
            city: cleanText(input.city, 40),
            discoverable: input.discoverable === true
          };
          if (profile.discoverable && me.showcase.length === 0) fail(409, "publish_showcase_first");
          me.profile = profile;
          return ownProfile(me);
        });
        json(res, 200, {user});
        return true;
      }
      if (method === "PUT" && path === "/showcase") {
        const input = await methodBody(req);
        const items = normalizeShowcase(input.items);
        const user = await transaction(db => {
          const me = auth(db, req);
          me.showcase = items;
          if (items.length === 0) me.profile.discoverable = false;
          return ownProfile(me);
        });
        json(res, 200, {user});
        return true;
      }
      if (method === "GET" && path === "/people") {
        limit(req, "discovery", 60, 60000);
        const db = await read();
        const me = auth(db, req);
        const people = db.users.filter(u => visiblePeer(db, me, u)).map(user => ({
          ...publicProfile(user), match: matchPublic(me, user),
          relationship: connection(db, me.id, user.id)?.status || "none"
        })).filter(person=>person.match.score>0 || person.relationship==="accepted")
          .sort((a,b) => b.match.score - a.match.score || a.handle.localeCompare(b.handle)).slice(0, 100);
        json(res, 200, {people});
        return true;
      }
      if (method === "GET" && path === "/study/plans") {
        limit(req,"study-read",60,60000);
        const db=await read(),me=auth(db,req);
        const plans=(db.studyPlans || []).filter(plan=>
          ["pending","active"].includes(plan.status) &&
          (plan.creatorId===me.id || plan.partnerId===me.id) &&
          connected(db,plan.creatorId,plan.partnerId) &&
          !peersBlocked(byId(db,plan.creatorId),byId(db,plan.partnerId)))
          .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)
          .map(plan=>{
            const partner=byId(db,plan.creatorId===me.id?plan.partnerId:plan.creatorId);
            return {id:plan.id,topic:plan.topic,goals:plan.goals,status:plan.status,
              incoming:plan.partnerId===me.id && plan.status==="pending",
              peer:{id:partner.id,displayName:partner.profile.displayName,handle:partner.handle},
              mine:plan.progress?.[me.id] || [],theirs:plan.progress?.[partner.id] || [],
              createdAt:plan.createdAt};
          });
        json(res,200,{plans});
        return true;
      }
      if (method === "POST" && path === "/study/plans") {
        limit(req,"study-create",10,3600000);
        const input=await methodBody(req);
        const topic=cleanText(input.topic,80);
        const goals=Array.isArray(input.goals) ?
          [...new Set(input.goals.map(x=>cleanText(x,100)).filter(Boolean))].slice(0,5) : [];
        if(!topic || !goals.length || goals.length>5)fail(400,"invalid_study_plan");
        const id=await transaction(db=>{
          const me=auth(db,req),peer=byId(db,input.peerId);
          if(!connected(db,me.id,peer.id) || peersBlocked(me,peer))fail(403,"friendship_required");
          if(peer.suspendedUntil && new Date(peer.suspendedUntil).getTime()>Date.now())fail(403,"peer_unavailable");
          const now=new Date().toISOString(),id=randomUUID();
          db.studyPlans ||= [];
          if(db.studyPlans.filter(p=>["pending","active"].includes(p.status) &&
              (p.creatorId===me.id || p.partnerId===me.id)).length>=25)fail(429,"study_plan_limit");
          db.studyPlans.push({id,creatorId:me.id,partnerId:peer.id,topic,goals,
            status:"pending",progress:{[me.id]:[],[peer.id]:[]},createdAt:now});
          return id;
        });
        json(res,201,{id,status:"pending"});
        return true;
      }
      if (method === "PUT" && path.startsWith("/study/plans/")) {
        const input=await methodBody(req),id=path.slice("/study/plans/".length);
        const action=input.action;
        if(!["accept","decline","cancel","toggle"].includes(action))fail(400,"invalid_study_action");
        const outcome=await transaction(db=>{
          const me=auth(db,req);
          const plan=(db.studyPlans || []).find(p=>p.id===id &&
            (p.creatorId===me.id || p.partnerId===me.id));
          if(!plan)fail(404,"study_plan_not_found");
          if(action==="cancel"){
            if(!["pending","active"].includes(plan.status))fail(409,"study_plan_inactive");
            plan.status="cancelled";
          }else{
            const partner=byId(db,plan.creatorId===me.id?plan.partnerId:plan.creatorId);
            if(!connected(db,me.id,partner.id) || peersBlocked(me,partner))fail(403,"friendship_required");
            if(action==="accept"||action==="decline"){
              if(plan.partnerId!==me.id||plan.status!=="pending")fail(403,"incoming_plan_required");
              plan.status=action==="accept"?"active":"declined";
            }else{
              if(plan.status!=="active")fail(409,"study_plan_not_active");
              const index=Number(input.goalIndex);
              if(!Number.isInteger(index)||index<0||index>=plan.goals.length)fail(400,"invalid_goal_index");
              plan.progress ||= {};
              const mine=new Set(plan.progress[me.id] || []);
              if(mine.has(index))mine.delete(index);else mine.add(index);
              plan.progress[me.id]=[...mine].sort((a,b)=>a-b);
            }
          }
          return {status:plan.status,mine:plan.progress?.[me.id] || []};
        });
        json(res,200,{ok:true,...outcome});
        return true;
      }
      if (method === "GET" && path === "/connections") {
        const db = await read();
        const me = auth(db, req);
        const relations = db.connections.filter(c => ["pending", "accepted"].includes(c.status) &&
          (c.from === me.id || c.to === me.id)).filter(c => !peersBlocked(me, byId(db, c.from === me.id ? c.to : c.from)));
        json(res, 200, {connections: relations.map(c => connectionPayload(db, c, me.id)),
          blocked: (me.blocked || []).map(id => db.users.find(u => u.id === id)).filter(Boolean).map(u => ({id: u.id, handle: u.handle}))});
        return true;
      }
      if (method === "POST" && path === "/connections") {
        limit(req, "requests", 25, 3600000);
        const input = await methodBody(req);
        const id = await transaction(db => {
          const me = auth(db, req), target = byId(db, input.targetId);
          if (!visiblePeer(db, me, target)) fail(403, "peer_not_discoverable");
          if (connection(db, me.id, target.id)) fail(409, "request_exists");
          if (db.connections.some(c=>c.from===me.id && c.to===target.id &&
              c.status==="declined" && Date.now()-new Date(c.createdAt).getTime()<7*86400000)) {
            fail(429,"recent_declined_request");
          }
          const id = randomUUID();
          db.connections.push({id, from: me.id, to: target.id, status: "pending", createdAt: new Date().toISOString()});
          return id;
        });
        json(res, 201, {id, status: "pending"});
        return true;
      }
      if (method === "PUT" && path.startsWith("/connections/")) {
        const id = path.split("/")[2];
        const input = await methodBody(req);
        if (!["accept", "decline"].includes(input.action)) fail(400, "invalid_decision");
        const state = await transaction(db => {
          const me = auth(db, req), relation = db.connections.find(c => c.id === id && c.to === me.id && c.status === "pending");
          if (!relation) fail(404, "incoming_request_not_found");
          if (peersBlocked(me, byId(db, relation.from))) fail(403, "peer_blocked");
          relation.status = input.action === "accept" ? "accepted" : "declined";
          return relation.status;
        });
        json(res, 200, {status: state});
        return true;
      }
      if (method === "POST" && path === "/blocks") {
        const input = await methodBody(req);
        await transaction(db => {
          const me = auth(db, req), peer = byId(db, input.targetId);
          if (me.id === peer.id) fail(400, "cannot_block_self");
          me.blocked = [...new Set([...(me.blocked || []), peer.id])];
          db.connections = db.connections.filter(c => !(c.from === me.id && c.to === peer.id || c.from === peer.id && c.to === me.id));
          db.studyPlans=(db.studyPlans||[]).filter(p=>!((p.creatorId===me.id&&p.partnerId===peer.id)||(p.creatorId===peer.id&&p.partnerId===me.id)));
          db.readStates=(db.readStates||[]).filter(s=>!((s.userId===me.id&&s.peerId===peer.id)||(s.userId===peer.id&&s.peerId===me.id)));
          return true;
        });
        json(res, 200, {ok: true});
        return true;
      }
      if (method === "DELETE" && path.startsWith("/blocks/")) {
        const id = path.split("/")[2];
        await transaction(db => {
          const me = auth(db, req);
          me.blocked = (me.blocked || []).filter(v => v !== id);
          return true;
        });
        json(res, 200, {ok: true});
        return true;
      }
      if (method === "GET" && path === "/notifications") {
        limit(req,"notifications",60,60000);
        const db=await read(),me=auth(db,req);
        const pending=db.connections.filter(c=>c.to===me.id&&c.status==="pending"&&!peersBlocked(me,byId(db,c.from))).length;
        const studyInvites=db.studyPlans.filter(p=>p.partnerId===me.id&&p.status==="pending"&&
          connected(db,p.creatorId,me.id)).length;
        const unread=store.unreadForUser(me.id,db.readStates).filter(item=>{
          const peer=db.users.find(u=>u.id===item.peerId);
          return peer&&!peersBlocked(me,peer)&&connected(db,me.id,peer.id);
        });
        json(res,200,{pending,studyInvites,unread,total:pending+studyInvites+unread.reduce((sum,p)=>sum+p.count,0)});
        return true;
      }
      if (method === "POST" && path === "/messages/read") {
        const input=await methodBody(req);
        const at=await transaction(db=>{
          const me=auth(db,req),peer=byId(db,input.peerId);
          if(!connected(db,me.id,peer.id)||peersBlocked(me,peer))fail(403,"friendship_required");
          const last=store.db.prepare("SELECT created_at FROM messages WHERE owner=? AND peer=? ORDER BY created_at DESC,id DESC LIMIT 1").get(peer.id,me.id);
          if(!last)return null;
          const state=db.readStates.find(s=>s.userId===me.id&&s.peerId===peer.id);
          if(state)state.lastReadAt=last.created_at;
          else db.readStates.push({id:randomUUID(),userId:me.id,peerId:peer.id,lastReadAt:last.created_at});
          return last.created_at;
        });
        json(res,200,{ok:true,lastReadAt:at});
        return true;
      }
      if (method === "GET" && path === "/messages") {
        limit(req, "message-read", 80, 60000);
        const db = await read();
        const me = auth(db, req);
        const peer = byId(db, url.searchParams.get("peer"));
        if (peersBlocked(me, peer) || !connected(db, me.id, peer.id)) fail(403, "friendship_required");
        const raw=url.searchParams.get("before");
        let before=null;
        if(raw){
          try{
            const cursor=JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));
            if(typeof cursor.createdAt!=="string"||!/^[0-9a-f-]{36}$/.test(cursor.id))throw Error();
            before=cursor;
          }catch{fail(400,"invalid_cursor");}
        }
        const {messages,hasMore}=store.messagesBetween(me.id,peer.id,{limit:50,before});
        const first=messages[0];
        const nextCursor=hasMore&&first?Buffer.from(JSON.stringify({createdAt:first.createdAt,id:first.id})).toString("base64url"):null;
        json(res,200,{messages,nextCursor,hasMore});
        return true;
      }
      if (method === "POST" && path === "/messages") {
        limit(req, "messages", 40, 60000);
        const input = await methodBody(req);
        const message = await serialized(async()=>{
          const db=await read(),me=auth(db,req),peer=byId(db,input.peerId);
          if(peersBlocked(me,peer)||!connected(db,me.id,peer.id))fail(403,"friendship_required");
          const text=cleanText(input.text,1000);
          if(!text)fail(400,"message_required");
          const msg={id:randomUUID(),from:me.id,to:peer.id,text,createdAt:new Date().toISOString()};
          store.appendMessage(msg);
          return msg;
        });
        json(res, 201, {message});
        return true;
      }
      if (method === "POST" && path === "/reports") {
        limit(req, "reports", 10, 3600000);
        const input = await methodBody(req);
        const reason = cleanText(input.reason, 30);
        if (!["harassment", "spam", "privacy", "other"].includes(reason)) fail(400, "invalid_report_reason");
        await transaction(db => {
          const me = auth(db, req), peer = byId(db, input.targetId);
          if (me.id === peer.id) fail(400, "cannot_report_self");
          db.reports.push({id: randomUUID(), from: me.id, target: peer.id, reason,
            details: cleanText(input.details, 300), createdAt: new Date().toISOString(), reviewed: false});
          return true;
        });
        json(res, 201, {ok: true, status: "queued_for_manual_review"});
        return true;
      }
      if (method === "DELETE" && path === "/account") {
        const input = await methodBody(req);
        await transaction(db => {
          const me = auth(db, req, {allowSuspended:true});
          if (!passwordValid(String(input.password || ""), me.passwordHash)) fail(403, "password_confirmation_required");
          db.users = db.users.filter(u => u.id !== me.id);
          db.sessions = db.sessions.filter(s => s.userId !== me.id);
          db.connections = db.connections.filter(c => c.from !== me.id && c.to !== me.id);
          db.messages = db.messages.filter(m => m.from !== me.id && m.to !== me.id);
          db.studyPlans=(db.studyPlans||[]).filter(p=>p.creatorId!==me.id&&p.partnerId!==me.id);
          db.readStates=(db.readStates||[]).filter(s=>s.userId!==me.id&&s.peerId!==me.id);
          db.recoveryCodes=(db.recoveryCodes||[]).filter(c=>c.userId!==me.id);
          db.appeals=(db.appeals||[]).filter(x=>x.userId!==me.id);
          db.reports = db.reports.filter(r => r.from !== me.id && r.target !== me.id);
          db.users.forEach(u => {u.blocked = (u.blocked || []).filter(id => id !== me.id);});
          return true;
        });
        json(res, 200, {ok: true}, {"Set-Cookie": setCookie(req, "", 0)});
        return true;
      }
      fail(404, "endpoint_not_found");
    } catch (e) {
      if (!e.status) console.error("[tongpin api]", e?.message || "unknown_error");
      if (!res.headersSent) json(res, e.status || 500, {error: e.status ? e.message : "internal_error"});
      return true;
    }
  };
}
