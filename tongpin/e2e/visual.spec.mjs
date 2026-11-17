import {test,expect} from "@playwright/test";
test("desktop and narrow-mobile layouts preserve navigation and prevent horizontal overflow",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/tongpin/");
  const backup={type:"tongpin_private_library",version:2,videos:[
    {bvid:"BV1234567890",title:"AI 电影制作从入门到实践（界面演示）",tags:["AI","电影"],notes:"只在本机的示例笔记"},
    {bvid:"BV0987654321",title:"用 Python 制作创意工具（界面演示）",tags:["编程","Python"]}
  ]};
  await page.locator("#import-file").setInputFiles({
    name:"fictional-demo.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator("#stat-count")).toHaveText("2");
  await page.screenshot({path:"test-results/tongpin-desktop-library.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator("#nav")).toBeVisible();
  await expect(page.locator("#nav [data-tab=learning]")).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator("#nav [data-tab=learning]").click();
  await expect(page.locator("#tab-learning")).toBeVisible();
  await page.locator("#nav [data-tab=showcase]").click();
  await expect(page.locator("#tab-showcase")).toBeVisible();
  await page.locator("#nav [data-tab=library]").click();
  await page.screenshot({path:"test-results/tongpin-mobile-library.png",fullPage:true});
});
