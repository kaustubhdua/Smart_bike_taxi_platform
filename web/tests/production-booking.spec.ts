import { expect, test } from "@playwright/test";

test.skip(!process.env.RIDEFORGE_LIVE_E2E, "Runs only for the one-time post-deploy production acceptance check.");

test("production passenger can receive a real Noida route quote", async ({ page }) => {
  const productionUrl = new URL("/passenger", process.env.RIDEFORGE_PRODUCTION_URL ?? "https://smart-bike-taxi-platform.vercel.app/").toString();

  await expect.poll(async () => {
    try {
      await page.goto(productionUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch {
      // Vercel may still be promoting the deployment; retry until the build marker is served.
    }
    return page.locator('meta[name="rideforge-geocoding-mode"]').getAttribute("content").catch(() => null);
  }, { timeout: 180_000, intervals: [1_000, 2_000, 5_000, 10_000] }).toBe("browser-photon-v1");

  await page.getByRole("combobox", { name: "Pickup point" }).fill("JIIT Sector 128, Noida");
  await page.getByRole("combobox", { name: "Drop-off point" }).fill("Sector 18 Market, Noida");
  await page.getByRole("button", { name: /Get server fare quote/ }).click();

  await expect(page.getByText("Route found")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".fare-amount")).toContainText(/₹\d+\.\d{2}/);
  await expect(page.locator(".fare-breakdown")).toBeVisible();
  await expect(page.getByText("Quote verified")).toBeVisible();
});
