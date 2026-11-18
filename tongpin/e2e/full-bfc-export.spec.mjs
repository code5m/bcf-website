import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";

test("BFC studio exports actual video records and state in a full user-downloaded JSON",async({page})=>{
  const videoRecords={
    BV1234567890:{bvid:"BV1234567890",title:"演示来源的影视课程",author:"真实字段示例",
      raw:{title:"演示来源的影视课程",topic:"影视",pic:"https://i0.hdslb.com/one.jpg"}},
    BV0987654321:{bvid:"BV0987654321",title:"演示来源的音乐课程",author:"创作者",
      raw:{topic:"音乐"}}
  };
  const source={state:{videos:videoRecords,
    library:{topics:[],categories:{"BV1234567890":"影视"},
      notes:{"BV1234567890":"这是仅供本地下载的私人笔记"},
      watched:{"BV0987654321":true}}},
    summary:{revision:2}};
  await page.route("**/api/session",route=>route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({token:"a".repeat(64)})}));
  await page.route("**/api/workbench/state",route=>route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify(route.request().method()==="PUT"?{summary:{revision:3}}:source)}));
  await page.goto("/studio.html");
  await expect(page.locator("#message")).toContainText("2 个视频");
  const [download]=await Promise.all([
    page.waitForEvent("download"),page.locator("#export").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^bfc-complete-collection-\d{4}-\d\d-\d\d\.json$/);
  const output=JSON.parse(await readFile(await download.path(),"utf8"));
  expect(output.type).toBe("workbench_backup");
  expect(Object.keys(output.state.videos)).toHaveLength(2);
  expect(output.state.videos.BV1234567890.title).toBe("演示来源的影视课程");
  expect(output.state.library.categories.BV1234567890).toBe("影视");
  expect(output.state.library.notes.BV1234567890).toBe("这是仅供本地下载的私人笔记");
  await page.goto("/tongpin/?setup=1");
  await expect(page.locator("#owner-setup-tools")).toBeVisible();
  await page.locator("#browseros-preview-file").setInputFiles({name:download.suggestedFilename(),
    mimeType:"application/json",buffer:Buffer.from(JSON.stringify(output))});
  await expect(page.locator("#browseros-preview-summary")).toContainText("2 条去重 BV 视频");
  await expect(page.locator("#browseros-preview-list")).toContainText("演示来源的影视课程");
});
