import {test,expect} from "@playwright/test";

async function goTo(page,tab){
  if(tab==="showcase"||tab==="learning"){
    await page.locator("#nav [data-tab=account]").click();
    await page.locator(tab==="showcase"?"#shortcut-showcase":"#shortcut-learning").click();
  }else await page.locator('#nav [data-tab="'+tab+'"]').click();
}

test("desktop and narrow-mobile layouts preserve navigation and prevent horizontal overflow",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/tongpin/");
  await expect(page.locator("#page-title")).toHaveText("视频");
  await expect(page.locator("#feed-feature .spotlight-empty")).toBeVisible();
  await expect(page.locator("#nav .nav-item")).toHaveCount(4);
  await expect(page.locator("#nav [data-tab=discover]")).toBeVisible();
  const backup={type:"tongpin_private_library",version:2,videos:[
    {bvid:"BV1234567890",title:"AI 电影制作从入门到实践（界面演示）",tags:["AI","电影"],notes:"只在本机的示例笔记"},
    {bvid:"BV0987654321",title:"用 Python 制作创意工具（界面演示）",tags:["编程","Python"]}
  ]};
  await page.locator("#import-file").setInputFiles({
    name:"fictional-demo.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator("#stat-count")).toHaveText("2");
  await expect(page.locator("#feed-feature .spotlight-video")).toBeVisible();
  await expect(page.locator("#video-not-real-thumbnail")).toHaveCount(0);
  const videoLink=page.locator("#feed-feature .poster-large");
  await expect(videoLink).toHaveAttribute("href",/https:\/\/www\.bilibili\.com\/video\/BV/);
  await expect(page.locator("#notice")).toBeHidden({timeout:7000});
  await page.screenshot({path:"test-results/tongpin-desktop-library.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator("#nav")).toBeVisible();
  await expect(page.locator("#nav .nav-item")).toHaveCount(4);
  const diagnostics=await page.evaluate(()=>{
    const vw=window.innerWidth;
    const bad=[...document.querySelectorAll("*")].filter(el=>{
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=="none" && r.width>0 && (r.right>vw+1 || r.left < -1);
    }).sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right)
      .slice(0,14).map(el=>{
        const r=el.getBoundingClientRect();
        return {name:el.tagName.toLowerCase(),id:el.id,cls:String(el.className).slice(0,90),
          left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),scroll:el.scrollWidth};
      });
    return {overflow:document.documentElement.scrollWidth-vw,bad};
  });
  if(diagnostics.overflow>1)console.log("MOBILE_OVERFLOW_DIAG",JSON.stringify(diagnostics));
  expect(diagnostics.overflow).toBeLessThanOrEqual(1);
  await expect(page.locator("#feed-feature .spotlight-video")).toBeVisible();
  await expect(page.locator("#feed-channels button")).toHaveCount(5);
  await page.locator('#feed-channels button[data-feed-tag="编程"]').click();
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(1);
  await page.locator('#feed-channels button[data-feed-tag=""]').click();
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(2);
  await page.locator("#nav [data-tab=discover]").click();
  await expect(page.locator("#meet-profile-cta")).toBeVisible();
  await expect(page.locator("#match-status")).toContainText("公开分享用户");
  await goTo(page,"learning");
  await expect(page.locator("#tab-learning")).toBeVisible();
  await goTo(page,"showcase");
  await expect(page.locator("#tab-showcase")).toBeVisible();
  await page.locator("#nav [data-tab=library]").click();
  await page.screenshot({path:"test-results/tongpin-mobile-library.png",fullPage:true});
});
