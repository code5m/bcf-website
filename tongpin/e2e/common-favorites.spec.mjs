import {test,expect} from "@playwright/test";

test("private favorite matches a different user's opt-in public video without uploading private data",async({browser})=>{
  const owner=await browser.newContext(),visitor=await browser.newContext();
  const b=await owner.newPage(),a=await visitor.newPage();
  const requests=[];
  a.on("request",request=>{
    if(request.url().includes("/api/social/"))
      requests.push({url:request.url(),body:request.postData()||""});
  });
  a.on("dialog",d=>d.accept());b.on("dialog",d=>d.accept());
  const unique=Date.now().toString(36);
  try{
    await b.goto("/tongpin/");
    await b.locator("#add-trigger").click();
    await b.locator('#add-form [name="bvid"]').fill("BV1234567890");
    await b.locator('#add-form [name="title"]').fill("公开的共同视频");
    await b.locator('#add-form .button-primary').click();
    await b.locator('#library-list [data-action="toggle"]').click();
    await b.locator('#nav [data-tab=account]').click();
    await b.locator('#auth-form [name="handle"]').fill("b_"+unique);
    await b.locator('#auth-form [name="password"]').fill("strong-password-123");
    await b.locator('#auth-form [name="displayName"]').fill("电影同好");
    await b.locator('#auth-form [name="adult"]').check();
    await b.locator("#auth-submit").click();
    await b.locator("#shortcut-showcase").click();
    await b.locator("#publish-showcase").click();
    await b.locator('#nav [data-tab=account]').click();
    await b.locator('#profile-form [name="topics"]').fill("电影");
    await b.locator('#profile-form [name="discoverable"]').check();
    await b.locator('#profile-form .button-primary').click();

    await a.goto("/tongpin/");
    await a.locator("#import-file").setInputFiles({
      name:"private-backup.json",mimeType:"application/json",
      buffer:Buffer.from(JSON.stringify({type:"tongpin_private_library",version:3,
        videos:[
          {bvid:"BV1234567890",title:"我自己的标题",notes:"SUPER_PRIVATE_NOTE_X",
            sourceFolders:["我的私密文件夹"]},
          {bvid:"BV0987654321",title:"只有我收藏的另一条",notes:"ANOTHER_PRIVATE_BV"}
        ]}))
    });
    await a.locator('#nav [data-tab=discover]').click();
    await expect(a.locator("#discover-list .meet-card")).toHaveCount(1);
    await expect(a.locator("#discover-list")).toContainText("你也收藏了");
    await expect(a.locator("#discover-list")).toContainText("公开的共同视频");
    await expect(a.locator("#discover-list")).not.toContainText("SUPER_PRIVATE_NOTE_X");
    await expect(a.locator("#discover-list")).not.toContainText("我自己的标题");
    await expect(a.locator("#local-match-count")).toHaveText("1");
    expect(JSON.stringify(requests)).not.toContain("BV1234567890");
    expect(JSON.stringify(requests)).not.toContain("BV0987654321");
    expect(JSON.stringify(requests)).not.toContain("SUPER_PRIVATE_NOTE_X");
    expect(requests.some(x=>x.url.includes("/candidates"))).toBe(true);

    await a.locator('#discover-list [data-action=request]').click();
    await expect(a.locator("#tab-account")).toBeVisible();
    await expect(a.locator("#notice")).toContainText("不会自动发送");
    await a.locator('#auth-form [name="handle"]').fill("a_"+unique);
    await a.locator('#auth-form [name="password"]').fill("strong-password-123");
    await a.locator('#auth-form [name="displayName"]').fill("本地收藏者");
    await a.locator('#auth-form [name="adult"]').check();
    await a.locator("#auth-submit").click();
    await expect(a.locator("#tab-discover")).toBeVisible();
    await expect(a.locator("#pending-contact")).toContainText("继续刚才");
    await a.locator('#pending-contact [data-action=request]').click();
    await expect(a.locator("#pending-contact")).toBeHidden();
    await b.locator('#nav [data-tab=friends]').click();
    await expect(b.locator("#friends-list")).toContainText("本地收藏者");
    await b.locator('#friends-list [data-action=accept]').click();
    await a.locator('#nav [data-tab=friends]').click();
    await a.locator("#refresh-friends").click();
    await expect(a.locator("#friends-list")).toContainText("电影同好");
  }finally{await owner.close();await visitor.close();}
});

test("private-only collections do not create a false remote discovery match",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  await page.locator("#import-file").setInputFiles({
    name:"private.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify({type:"tongpin_private_library",version:3,
      videos:[{bvid:"BV1234567890",title:"未公开的收藏",notes:"隐私不是公开匹配证据"}]}))
  });
  await page.locator('#nav [data-tab=discover]').click();
  await expect(page.locator("#discover-list")).toContainText("暂未发现相同收藏");
  await expect(page.locator("#local-match-count")).toHaveText("0");
  await page.locator("#match-filter-all").click();
  await expect(page.locator("#match-filter-all")).toHaveAttribute("aria-pressed","true");
});
