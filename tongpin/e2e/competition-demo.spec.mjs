import {test,expect} from "@playwright/test";

test("contest journey: videos, shared favorite, consent, chat, reply and study",async({page})=>{
  const outgoing=[];
  page.on("request",req=>{if(req.url().includes("/api/social/")||req.url().includes("bilibili.com"))outgoing.push(req.url());});
  await page.setViewportSize({width:390,height:844});
  await page.goto("/tongpin/?demo=1");
  await expect(page.locator("#contest-demo")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeHidden();
  await expect(page.locator(".tpd-bottom-nav button")).toHaveCount(4);
  await expect(page.locator(".tpd-video-grid .tpd-video-item")).toHaveCount(4);
  await expect(page.locator(".tpd-demo-chip")).toContainText("非真实用户");
  await expect(page.locator(".tpd-video-screen")).toContainText("原创示例内容");
  await page.screenshot({path:"test-results/tongpin-demo-mobile-video.png",fullPage:true});
  await page.locator('[data-action="find-video"][data-id="film"]').click();
  await expect(page.locator(".tpd-people-grid .tpd-person")).toHaveCount(2);
  await expect(page.locator(".tpd-people-grid")).toContainText("虚构演示用户");
  await expect(page.locator(".tpd-match-detail")).toContainText("共同点");
  await page.screenshot({path:"test-results/tongpin-demo-mobile-meet.png",fullPage:true});
  await page.locator('[data-action="request"]').click();
  await expect(page.locator(".tpd-accept-demo")).toContainText("真实 APP 必须等待对方同意");
  await expect(page.locator(".tpd-steps .done")).toHaveCount(2);
  await page.locator('[data-action="accept"]').click();
  await expect(page.locator(".tpd-conversation")).toBeVisible();
  await expect(page.locator(".tpd-steps .done")).toHaveCount(3);
  await page.locator('[data-action="suggest"]').first().click();
  await expect(page.locator("#tpd-chat-form input")).toHaveValue(/光影的短片/);
  await page.locator("#tpd-chat-form button").click();
  await expect(page.locator(".tpd-chat-row.mine")).toHaveCount(1);
  await expect(page.locator(".tpd-steps .done")).toHaveCount(4);
  await page.locator('[data-action="reply"]').click();
  await expect(page.locator(".tpd-chat-row.theirs")).toHaveCount(1);
  await page.locator('[data-action="study"]').click();
  await expect(page.locator(".tpd-goals")).toBeVisible();
  await page.locator('[data-action="goal"][data-index="0"]').click();
  await expect(page.locator('[data-action="goal"][data-index="0"]')).toHaveAttribute("aria-pressed","true");
  await page.screenshot({path:"test-results/tongpin-demo-mobile-chat.png",fullPage:true});
  await page.locator('.tpd-bottom-nav [data-tab="mine"]').click();
  await expect(page.locator(".tpd-privacy-card")).toContainText("不会注册、私信");
  await expect(page.locator(".tpd-metrics")).toContainText("0");
  expect(outgoing).toEqual([]);
  await page.locator('[data-action="reset"]').click();
  await expect(page.locator(".tpd-video-screen")).toBeVisible();
  await page.locator(".tpd-exit").click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("#contest-demo")).toBeHidden();
  await expect(page).not.toHaveURL(/demo=1/);
});

test("entering and exiting demonstration never changes real private favorites",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  await expect(page.locator("#feed-feature .spotlight-empty")).toBeVisible();
  await expect(page.locator("#stat-count")).toHaveText("0");
  await page.locator("#import-file").setInputFiles({name:"private.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify({type:"tongpin_private_library",version:3,
      videos:[{bvid:"BV1234567890",title:"本人真实片单测试记录",
        tags:["仅本人"],notes:"不要进入模拟用户资料的私人笔记"}]}))});
  await expect(page.locator("#stat-count")).toHaveText("1");
  await page.locator("#contest-demo-top").click();
  await expect(page.locator("#contest-demo")).toBeVisible();
  await expect(page.locator("#contest-demo")).not.toContainText("不要进入模拟用户资料的私人笔记");
  await page.locator(".tpd-exit").click();
  await expect(page.locator("#stat-count")).toHaveText("1");
  await expect(page.locator("#library-list")).toContainText("本人真实片单测试记录");
  await page.reload();
  await expect(page.locator("#stat-count")).toHaveText("1");
});

test("desktop and 320px-768px viewports remain responsive",async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  await page.goto("/tongpin/?demo=1");
  await expect(page.locator(".tpd-side-nav button")).toHaveCount(4);
  await page.screenshot({path:"test-results/tongpin-demo-desktop-video.png",fullPage:true});
  await page.locator('.tpd-side-nav [data-tab="meet"]').click();
  await page.screenshot({path:"test-results/tongpin-demo-desktop-meet.png",fullPage:true});
  for(const width of [320,360,390,430,768]){
    await page.setViewportSize({width,height:760});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    expect(overflow,"Viewport "+width+"px should not overflow").toBeLessThanOrEqual(1);
    await expect(page.locator(".tpd-match-detail")).toBeVisible();
  }
  await page.setViewportSize({width:390,height:760});
  await page.locator('.tpd-bottom-nav [data-tab="messages"]').click();
  await expect(page.locator(".tpd-empty-chat")).toContainText("双方都愿意");
});
