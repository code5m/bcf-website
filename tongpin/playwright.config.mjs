import {defineConfig,devices} from "@playwright/test";
import {resolve} from "node:path";
export default defineConfig({
  testDir:"./e2e",
  timeout:90000,
  expect:{timeout:15000},
  workers:1,
  retries:1,
  reporter:"list",
  use:{baseURL:"http://127.0.0.1:4173",trace:"retain-on-failure",...devices["Desktop Chrome"]},
  webServer:{
    command:"node server.mjs",
    url:"http://127.0.0.1:4173/api/social/health",
    reuseExistingServer:false,
    timeout:30000,
    env:{...process.env, TONGPIN_DATA_DIR:resolve("runtime/e2e-social")}
  }
});
