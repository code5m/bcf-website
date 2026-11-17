import {test,expect} from "@playwright/test";

test("BrowserOS BFC workbench backup imports real private videos, folders, authors, covers and topics locally",async({page})=>{
  const outgoing=[];
  page.on("dialog",dialog=>dialog.accept());
  page.on("request",request=>{
    if(request.url().includes("/api/social/"))
      outgoing.push({url:request.url(),body:request.postData()||""});
  });
  await page.goto("/tongpin/");
  await expect(page.locator("#stat-count")).toHaveText("0");
  const backup={
    type:"workbench_backup",version:1,
    state:{
      library:{
        videos:{
          BV1234567890:{bvid:"BV1234567890",title:"BrowserOS 真实收藏 · 电影镜头",
            author:"真实 UP 主 A",cover:"https://i0.hdslb.com/bfs/archive/real-a.jpg",
            sourceFolders:["默认收藏夹"],tags:["电影"]}
        },
        topics:[{name:"电影与影像",items:[
          {bvid:"BV1234567890",title:"BrowserOS 真实收藏 · 电影镜头"},
          {bvid:"BV0987654321",title:"BrowserOS 真实收藏 · 光影练习",
            author:"真实 UP 主 B",coverUrl:"https://archive.biliimg.com/bfs/archive/real-b.jpg",
            sourceFolders:["摄影收藏夹"]}
        ]}],
        categories:{"BV1234567890":"电影"}
      },
      notes:{"BV1234567890":"这条笔记只允许留在本人设备"},
      progress:{"BV1234567890":{percent:73,completed:false}},
      watched:{"BV0987654321":true}
    }
  };
  await page.locator("#import-file").setInputFiles({
    name:"browseros-bfc-backup.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator("#stat-count")).toHaveText("2");
  await expect(page.locator("#library-list .video-post-card")).toHaveCount(2);
  await expect(page.locator("#library-list")).toContainText("BrowserOS 真实收藏 · 电影镜头");
  await expect(page.locator("#library-list")).toContainText("真实 UP 主 A");
  await expect(page.locator("#library-list")).toContainText("默认收藏夹");
  await expect(page.locator("#library-list .poster-cover")).toHaveCount(2);
  await expect(page.locator("#library-list .poster-cover").first()).toHaveAttribute("src","https://i0.hdslb.com/bfs/archive/real-a.jpg");
  await expect(page.locator("#learning-list")).toHaveCount(1);
  await page.locator('#nav [data-tab="learning"]').click();
  await expect(page.locator("#learning-list")).toContainText("电影与影像");
  await page.locator('#nav [data-tab="library"]').click();
  await expect(page.locator("#library-list")).toContainText("这条笔记只允许留在本人设备");
  await expect(page.locator("#community-list")).not.toContainText("这条笔记只允许留在本人设备");
  expect(JSON.stringify(outgoing)).not.toContain("BV1234567890");
  expect(JSON.stringify(outgoing)).not.toContain("BV0987654321");
  expect(JSON.stringify(outgoing)).not.toContain("这条笔记只允许留在本人设备");
  await page.locator(".manage-drawer summary").click();
  await page.locator("#undo-import").click();
  await expect(page.locator("#stat-count")).toHaveText("0");
  await expect(page.locator("#library-list")).toContainText("没有找到");
});

test("BFC import preview warns when a BrowserOS readback is only a partial snapshot",async({page})=>{
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/tongpin/");
  const partial={
    source:"authorized_browser_readback",scanId:"partial-fixture",
    reportedTotal:4869,expectedPages:200,traversalFinished:false,
    pages:{"1":{items:[{bvid:"BV1234567890",title:"首批读取收藏"}]}}
  };
  await page.locator("#import-file").setInputFiles({
    name:"partial-readback.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify(partial))
  });
  await expect(page.locator("#stat-count")).toHaveText("1");
  await expect(page.locator("#notice")).toContainText("部分快照");
  await expect(page.locator("#library-list")).toContainText("首批读取收藏");
});
