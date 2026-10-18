import { expect, test } from "@playwright/test";

const routeFixture = {
  code: "Ok",
  routes: [{
    distance: 5200,
    duration: 840,
    geometry: { type: "LineString", coordinates: [[77.33, 28.53], [77.34, 28.54], [77.35, 28.55]] },
  }],
};

async function mockRouting(page: import("@playwright/test").Page) {
  await page.route("https://nominatim.openstreetmap.org/search?**", async route => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const lat = query.includes("JIIT") ? "28.535" : query.includes("Botanical") ? "28.564" : "28.55";
    const lon = query.includes("JIIT") ? "77.35" : query.includes("Botanical") ? "77.334" : "77.34";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat, lon, display_name: query }]) });
  });
  await page.route("https://router.project-osrm.org/route/v1/driving/**", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routeFixture) });
  });
  await page.route("**://*.tile.openstreetmap.org/**", route => route.abort());
}

test("calculates road route and shows a fare only after a valid server quote", async ({ page }) => {
  await mockRouting(page);
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        quoteId: "2a4e1bb0-4ed9-4bb2-a5a2-44f2f4ed8f4d",
        distanceKm: 5.2, durationMinutes: 14, farePaise: 4750, currency: "INR",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText(/5\.2 km · 14 min · Road route/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No invented price")).toBeVisible();
  await expect(page.locator(".fare-amount")).toContainText("—");
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.locator(".fare-amount")).toContainText("₹47.50");
  await expect(page.getByRole("status")).toContainText("This checks the quote only");
});

test("rejects expired or invalid quotes without showing a fare", async ({ page }) => {
  await mockRouting(page);
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        quoteId: "old-quote-id", distanceKm: 5.2, durationMinutes: 14,
        farePaise: -1, currency: "INR", expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText(/5\.2 km · 14 min · Road route/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.getByRole("status")).toContainText(/invalid or expired quote/i);
  await expect(page.locator(".fare-amount")).toContainText("—");
});

test("route failures are honest and do not enable quote requests", async ({ page }) => {
  await page.route("https://nominatim.openstreetmap.org/search?**", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/");
  await expect(page.getByText(/couldn't find/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Get server fare quote/ })).toBeDisabled();
  await expect(page.locator(".fare-amount")).toContainText("—");
});
