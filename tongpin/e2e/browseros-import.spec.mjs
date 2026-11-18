import {test,expect} from "@playwright/test";

test("BrowserOS bookmarks preview -> select real-shaped videos -> private local import -> undo",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  const posts=[];
  page.on("request",req=>{
    if(req.url().includes("/api/social/")&&req.method()!=="GET")posts.push(req.url());
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto("/tongpin/");
  await expect(page.locator("#feed-feature .spotlight-empty")).toBeVisible();
  const bookmarks={roots:{bookmark_bar:{name:"书签栏",children:[
    {name:"AI收藏",children:[{name:"AI影片创作",url:"https://www.bilibili.com/video/BV1234567890"}]},
    {name:"音乐收藏",children:[{name:"音乐创作",url:"https://m.bilibili.com/video/BV0987654321"}]},
    {name:"同一个影片的另一份收藏",url:"https://www.bilibili.com/video/BV1234567890"},
    {name:"排除的网站",url:"https://example.com/video/BV1111111111"}
  ]}}};
  await page.locator("#browseros-preview-file").setInputFiles({name:"BrowserOS-Bookmarks.json",
    mimeType:"application/json",buffer:Buffer.from(JSON.stringify(bookmarks))});
  await expect(page.locator("#browseros-preview-dialog")).toBeVisible();
  await expect(page.locator("#browseros-preview-summary")).toContainText("2 条去重 BV 视频");
  await expect(page.locator("#browseros-preview-summary")).toContainText("重复 1 条");
  await expect(page.locator("#browseros-preview-list .browseros-preview-video")).toHaveCount(2);
  await expect(page.locator("#browseros-preview-list")).not.toContainText("排除的网站");
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator("#browseros-preview-folders").selectOption("AI收藏");
  await expect(page.locator("#browseros-preview-list .browseros-preview-video")).toHaveCount(1);
  await page.locator("#browseros-preview-folders").selectOption("");
  await page.locator("#browseros-preview-clear").click();
  await page.locator('#browseros-preview-list input[data-import-bvid="BV1234567890"]').check();
  await expect(page.locator("#browseros-preview-selected")).toContainText("1 条");
  await page.locator("#browseros-preview-confirm").click();
  await expect(page.locator("#browseros-preview-dialog")).toBeHidden();
  await expect(page.locator("#stat-count")).toHaveText("1");
  await expect(page.locator("#library-list")).toContainText("AI影片创作");
  await expect(page.locator("#library-list")).not.toContainText("音乐创作");
  expect(posts).toEqual([]);
  await page.locator(".manage-drawer summary").click();
  await page.locator("#undo-import").click();
  await expect(page.locator("#stat-count")).toHaveText("0");
});

test("BFC backup preview shows missing titles without auto-publishing private notes",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  await expect(page.locator("#feed-feature .spotlight-empty")).toBeVisible();
  const backup={type:"workbench_backup",state:{videos:{
    BV1234567890:{title:"摄影剪辑基础",author:"示例UP主"}},
    library:{topics:[{name:"摄影专题",items:["BV1234567890","BV0987654321"]}],
      notes:{BV1234567890:"绝不发到服务器的笔记"}}}};
  await page.locator("#browseros-preview-file").setInputFiles({
    name:"bfc.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator("#browseros-preview-summary")).toContainText("2 条去重 BV 视频");
  await expect(page.locator("#browseros-preview-summary")).toContainText("缺标题 1 条");
  await page.locator("#browseros-preview-missing").check();
  await expect(page.locator("#browseros-preview-list .browseros-preview-video")).toHaveCount(1);
  await expect(page.locator("#browseros-preview-list")).toContainText("待补齐标题");
  await page.locator("#browseros-preview-missing").uncheck();
  await page.locator("#browseros-preview-confirm").click();
  await expect(page.locator("#stat-count")).toHaveText("2");
  await expect(page.locator("#library-list")).toContainText("绝不发到服务器的笔记");
  await page.locator("#nav [data-tab=account]").click();
  await expect(page.locator("#stat-shared")).toHaveText("0");
});
