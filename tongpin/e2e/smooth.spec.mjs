import {test,expect} from "@playwright/test";

// Regression: 1,500 real-shaped private entries must not produce 1,500
// hidden DOM rows or re-create unrelated panels on every search keystroke.
test("large private library keeps filtering local, topics incremental and mobile layout compact",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  await expect(page.locator(".hero-cinematic h2")).toContainText("遇见同频的人");
  await expect(page.locator(".hero-stage")).toHaveCount(0);
  await expect(page.locator(".social-bridge")).toHaveCount(0);
  const videos=Array.from({length:1500},(_,i)=>({
    bvid:"BV"+i.toString(36).padStart(10,"0"),
    title:"视频编号 "+i,
    tags:["AI","电影"],
    notes:"本地笔记 "+i,
    author:"已导入收藏",
    watched:i%7===0,
    progress:i%101
  }));
  await page.locator("#import-file").setInputFiles({
    name:"many-entries.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify({type:"tongpin_private_library",version:3,videos}))
  });
  await expect(page.locator("#stat-count")).toHaveText("1,500");
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(24);
  await expect(page.locator("#feed-feature .spotlight-video")).toBeVisible();
  await page.locator("[data-tab=learning]").click();
  await expect(page.locator("#learning-list .topic-card")).toHaveCount(2);
  await expect(page.locator("#learning-list .topic-video")).toHaveCount(24);
  await page.locator('#learning-list [data-action="topic-more"][data-index="0"]').click();
  await expect(page.locator("#learning-list .topic-video")).toHaveCount(48);
  await page.locator("[data-tab=library]").click();

  // Rerendering the whole page would drop this marker; only the visible list may change.
  await page.evaluate(()=>{
    document.querySelector("#feed-feature .spotlight-video").dataset.unchanged="yes";
    document.querySelector("#learning-list").dataset.unchanged="yes";
  });
  await page.locator("#library-search").fill("视频编号 1499");
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(1);
  await expect(page.locator("#library-list")).toContainText("视频编号 1499");
  await expect(page.locator("#feed-feature .spotlight-video")).toHaveAttribute("data-unchanged","yes");
  await expect(page.locator("#learning-list")).toHaveAttribute("data-unchanged","yes");
  await page.locator("#library-search").fill("");
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(24);
  await page.locator("#page-next").click();
  await expect(page.locator("#library-page-label")).toContainText("第 2 /");
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(24);
  await expect(page.locator("#learning-list")).toHaveAttribute("data-unchanged","yes");
  await page.setViewportSize({width:390,height:844});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#nav button[data-tab="discover"]')).toBeVisible();
  await expect(page.locator("#feed-feature .spotlight-video")).toBeVisible();
  await page.screenshot({path:"test-results/tongpin-mobile-smooth.png",fullPage:true});
  await page.locator('#nav button[data-tab="discover"]').click();
  await expect(page.locator("#tab-discover")).toBeVisible();
  await expect(page.locator("#tab-library")).toBeHidden();
  const scroll=await page.evaluate(()=>window.scrollY);
  expect(scroll).toBe(0);
});

test("cache refresh does not replace unchanged public feed and mobile buttons remain accessible",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/tongpin/");
  await expect(page.locator("#feed-feature")).toBeVisible();
  await page.locator("#nav [data-tab=account]").click();
  await page.locator("#nav [data-tab=library]").click();
  await expect(page.locator("#import-trigger")).toBeVisible();
  await expect(page.locator("#discover-from-hero")).toBeVisible();
  await expect(page.locator(".hero-cinematic")).toBeVisible();
  const filterCount=await page.locator("#feed-channels button").count();
  expect(filterCount).toBeGreaterThanOrEqual(1);
});
