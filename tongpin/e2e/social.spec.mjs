import {test,expect} from "@playwright/test";

test("private library, opt-in share, real matching, mutual consent and messaging", async ({browser}) => {
  const alice=await browser.newContext();
  const bob=await browser.newContext();
  const a=await alice.newPage(), b=await bob.newPage();
  a.on("dialog", dialog=>dialog.accept());
  b.on("dialog", dialog=>dialog.accept());
  const suffix=Date.now().toString(36);
  async function addPrivate(page,tag) {
    await page.goto("/tongpin/");
    await page.locator("#add-trigger").click();
    await page.locator('#add-form [name="bvid"]').fill("BV1234567890");
    await page.locator('#add-form [name="title"]').fill("AI 电影制作入门");
    await page.locator('#add-form [name="tags"]').fill("电影,AI");
    await page.locator('#add-form [name="notes"]').fill("私密笔记："+tag);
    await page.locator('#add-form .button-primary').click();
    await expect(page.locator("#stat-count")).toHaveText("1");
    await expect(page.locator("#library-list")).toContainText("私密笔记："+tag);
    await page.locator("#library-list [data-action=toggle]").click();
    await page.locator("[data-tab=showcase]").click();
    await expect(page.locator("#showcase-list")).toContainText("AI 电影制作入门");
    await expect(page.locator("#showcase-list")).not.toContainText("私密笔记");
  }
  async function register(page,handle,name) {
    await page.locator("[data-tab=account]").click();
    await page.locator('#auth-form [name="handle"]').fill(handle);
    await page.locator('#auth-form [name="displayName"]').fill(name);
    await page.locator('#auth-form [name="password"]').fill("Strong-Pass-1234567");
    await page.locator('#auth-form [name="adult"]').check();
    await page.locator("#auth-submit").click();
    await expect(page.locator("#session-label")).toContainText("@"+handle);
  }
  async function publish(page) {
    await page.locator("[data-tab=showcase]").click();
    await page.locator("#publish-showcase").click();
    await expect(page.locator("#stat-shared")).toHaveText("1");
    await page.locator("[data-tab=account]").click();
    await page.locator('#profile-form [name="topics"]').fill("电影,AI");
    await page.locator('#profile-form [name="discoverable"]').check();
    await page.locator('#profile-form .button-primary').click();
  }
  try {
    await addPrivate(a,"Alice的内容");
    await register(a,"alice_"+suffix,"Alice");
    await publish(a);
    await addPrivate(b,"Bob的内容");
    await register(b,"bob_"+suffix,"Bob");
    await publish(b);
    await a.locator("[data-tab=discover]").click();
    await expect(a.locator("#discover-list")).toContainText("Bob");
    await expect(a.locator("#discover-list")).not.toContainText("Bob的内容");
    await a.locator("#discover-list [data-action=request]").click();
    await b.locator("[data-tab=friends]").click();
    await expect(b.locator("#friends-list")).toContainText("Alice");
    await b.locator("#friends-list [data-action=accept]").click();
    await a.locator("[data-tab=friends]").click();
    await a.locator("#refresh-friends").click();
    await a.locator("#friends-list [data-action=chat]").click();
    await a.locator("#chat-text").fill("一起学习电影制作吗？");
    await a.locator('#chat-form .button-primary').click();
    await expect(a.locator("#chat-list")).toContainText("一起学习电影制作吗？");
    await b.locator("#refresh-friends").click();
    await b.locator("#friends-list [data-action=chat]").click();
    await expect(b.locator("#chat-list")).toContainText("一起学习电影制作吗？");
    await b.locator("#friends-list [data-action=study]").click();
    await b.locator('#study-form [name="topic"]').fill("一起学习电影创作");
    await b.locator('#study-form [name="goals"]').fill("写一段短片脚本\n完成剪辑");
    await b.locator("#study-form .button-primary").click();
    await b.locator("[data-tab=learning]").click();
    await expect(b.locator("#study-plans")).toContainText("等待好友同意");
    await a.locator("[data-tab=learning]").click();
    await expect(a.locator("#study-plans")).toContainText("等你同意");
    await a.locator("#study-plans [data-action=study-accept]").click();
    await expect(a.locator("#study-plans")).toContainText("共同进行中");
    await a.locator("#study-plans [data-action=study-toggle]").first().click();
    await expect(a.locator("#study-plans")).toContainText("你完成 1 项");
    await b.locator("[data-tab=learning]").click();
    await expect(b.locator("#study-plans")).toContainText("对方完成 1 项");
    await b.locator("[data-tab=friends]").click();
    await b.locator("#friends-list [data-action=block]").click();
    await expect(b.locator("#friends-list")).not.toContainText("Alice");
    await a.locator("[data-tab=friends]").click();
    await a.locator("#refresh-friends").click();
    await expect(a.locator("#friends-list")).not.toContainText("Bob");
  } finally {
    await alice.close();
    await bob.close();
  }
});

test("visitor can use private library without registering and sees no fabricated peers",async({page})=>{
  await page.goto("/tongpin/");
  await expect(page.locator("#stat-count")).toHaveText("0");
  await page.locator("[data-tab=discover]").click();
  await expect(page.locator("#discover-list")).toContainText("登录后才能发现同频的人");
  const response=await page.request.get("/api/social/health");
  expect(response.status()).toBe(200);
  expect((await response.json()).externalBilibiliRequests).toBe(0);
});

test("BFC JSON imports topics, restores learning progress, and exports private backup",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  const payload={type:"workbench_backup",state:{
    videos:{"BV1234567890":{bvid:"BV1234567890",title:"电影后期入门",author:"创作者"}},
    library:{topics:[{id:"film",name:"电影实践",items:["BV1234567890"]}],
      categories:{"BV1234567890":"电影"},notes:{"BV1234567890":"私人笔记"},
      watched:{"BV1234567890":false}}
  }};
  await page.locator("#import-file").setInputFiles({
    name:"bfc-private-backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(payload))
  });
  await expect(page.locator("#stat-count")).toHaveText("1");
  await expect(page.locator("#library-list")).toContainText("私人笔记");
  await page.locator("[data-tab=learning]").click();
  await expect(page.locator("#learning-list")).toContainText("电影实践");
  await page.locator("[data-action=watched]").first().click();
  await expect(page.locator("#learning-list")).toContainText("1/1");
  await page.locator("[data-tab=library]").click();
  const [download]=await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-trigger").click()
  ]);
  expect(download.suggestedFilename()).toContain("tongpin-private-backup-");
});
test("private sharing draft can be reverted without exposing private note",async({page})=>{
  await page.goto("/tongpin/");
  await page.locator("#add-trigger").click();
  await page.locator('#add-form [name="bvid"]').fill("BV1234567890");
  await page.locator('#add-form [name="title"]').fill("个人私密收藏");
  await page.locator('#add-form [name="notes"]').fill("这个笔记绝不能公开");
  await page.locator("#add-form .button-primary").click();
  await page.locator("#library-list [data-action=toggle]").click();
  await page.locator("[data-tab=showcase]").click();
  await expect(page.locator("#showcase-list")).not.toContainText("这个笔记绝不能公开");
  await page.locator("#showcase-list [data-action=toggle]").click();
  await expect(page.locator("#showcase-list")).toContainText("公开橱窗还没有草稿");
});


test("two BFC imports preserve existing topic notes and offer atomic undo",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  const first={type:"workbench_backup",state:{
    videos:{"BV1234567890":{bvid:"BV1234567890",title:"第一段课程"}},
    library:{topics:[{name:"电影专题",notes:"我原来的专属学习笔记",
      chapters:["起步"],items:["BV1234567890"]}]}
  }};
  const next={type:"workbench_backup",state:{
    videos:{"BV0987654321":{bvid:"BV0987654321",title:"第二段课程"}},
    library:{topics:[{name:"电影专题",notes:"新备份提供的另一条笔记",
      chapters:["后期"],items:["BV0987654321"]}]}
  }};
  const upload=async payload=>page.locator("#import-file").setInputFiles({
    name:"private-backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(payload))
  });
  await upload(first);
  await expect(page.locator("#stat-count")).toHaveText("1");
  await upload(next);
  await expect(page.locator("#stat-count")).toHaveText("2");
  await page.locator("[data-tab=learning]").click();
  await expect(page.locator("#learning-list")).toContainText("我原来的专属学习笔记");
  await expect(page.locator("#learning-list")).toContainText("第一段课程");
  await expect(page.locator("#learning-list")).toContainText("第二段课程");
  await page.locator("[data-tab=library]").click();
  await page.locator("#undo-import").click();
  await expect(page.locator("#stat-count")).toHaveText("1");
  await expect(page.locator("#library-list")).not.toContainText("第二段课程");
  await page.reload();
  await expect(page.locator("#stat-count")).toHaveText("1");
});

test("switching social accounts does not retain the old account's visible profile",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  const make=async(name)=>{
    await page.locator("[data-tab=account]").click();
    await page.locator('#auth-form [name="handle"]').fill(name);
    await page.locator('#auth-form [name="password"]').fill("strong-password-123");
    await page.locator('#auth-form [name="displayName"]').fill(name);
    await page.locator('#auth-form [name="adult"]').check();
    await page.locator("#auth-submit").click();
    await expect(page.locator("#session-label")).toHaveText("@"+name);
  };
  await make("a_"+Date.now().toString(36));
  await page.locator("#logout").click();
  await expect(page.locator("#session-label")).toHaveText("离线私人模式");
  await expect(page.locator("#chat-panel")).toBeHidden();
  await expect(page.locator("#unread-count")).toBeHidden();
  await make("b_"+Date.now().toString(36));
  await page.locator("[data-tab=friends]").click();
  await expect(page.locator("#friends-list")).toContainText("还没有好友");
  await page.locator("[data-tab=learning]").click();
  await expect(page.locator("#study-plans")).toContainText("还没有共学计划");
});
