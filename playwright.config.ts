import { defineConfig, devices } from "@playwright/test";

// E2E runs against sample data (WARPNAUT_DEMO=1) so it is deterministic and never hits public APIs.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5191", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // LLM_PROVIDER=none: tests stay deterministic and never spend a real model quota from .env.
    command: "rm -rf .e2e-data && WARPNAUT_DATA_DIR=.e2e-data/sync WARPNAUT_DEMO=1 LLM_PROVIDER=none WARPNAUT_API_PORT=8791 node scripts/dev.mjs --port 5191 --strictPort",
    url: "http://localhost:5191",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
