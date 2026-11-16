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
    await page.locator('#add-form button[type="submit"]').click();
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
    await page.locator('#profile-form button[type="submit"]').click();
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
    await a.locator('#chat-form button[type="submit"]').click();
    await expect(a.locator("#chat-list")).toContainText("一起学习电影制作吗？");
    await b.locator("#refresh-friends").click();
    await b.locator("#friends-list [data-action=chat]").click();
    await expect(b.locator("#chat-list")).toContainText("一起学习电影制作吗？");
    await b.locator("#friends-list [data-action=block]").click();
    await expect(b.locator("#friends-list")).not.toContainText("Alice");
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
