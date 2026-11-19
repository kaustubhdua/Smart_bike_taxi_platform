import { expect, test } from "@playwright/test";

test.skip(!process.env.RIDEFORGE_LIVE_E2E, "Runs only for the one-time post-deploy production acceptance check.");

test("production passenger can receive a real Noida route quote", async ({ page }) => {
  const productionUrl = "https://smart-bike-taxi-platform.vercel.app/";

  await expect.poll(async () => {
    await page.goto(productionUrl, { waitUntil: "domcontentloaded" });
    return page.locator('meta[name="rideforge-geocoding-mode"]').getAttribute("content");
  }, { timeout: 180_000, intervals: [1_000, 2_000, 5_000, 10_000] }).toBe("browser-photon-v1");

  await page.getByRole("textbox", { name: "Pickup point" }).fill("JIIT Sector 128, Noida");
  await page.getByRole("textbox", { name: "Drop-off point" }).fill("Sector 18 Market, Noida");
  await page.getByRole("button", { name: /Get server fare quote/ }).click();

  await expect(page.getByText("Route found")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".fare-amount")).toContainText(/₹\d+\.\d{2}/);
  await expect(page.locator(".fare-breakdown")).toBeVisible();
  await expect(page.getByText("Quote verified")).toBeVisible();
});
