import AxeBuilder from "@axe-core/playwright";
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
  await expect(page.locator(".inline-notice")).toContainText("This checks the quote only");
});

test("registers a passenger, creates a persisted ride request, and cancels it", async ({ page }) => {
  await mockRouting(page);
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      quoteId: "2a4e1bb0-4ed9-4bb2-a5a2-44f2f4ed8f4d", distanceKm: 5.2,
      durationMinutes: 14, farePaise: 4750, currency: "INR",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }) });
  });
  await page.route("http://api.test/api/v1/auth/register", async route => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      accessToken: "test-access-token", account: { email: "rider@example.test", displayName: "Test Rider" },
    }) });
  });
  await page.route("http://api.test/api/v1/rides", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-access-token");
    expect(route.request().headers()["idempotency-key"]).toContain("saarthi-");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000001", status: "requested",
    }) });
  });
  await page.route("http://api.test/api/v1/rides/*/cancel", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-access-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000001", status: "cancelled",
    }) });
  });

  await page.goto("/");
  await expect(page.getByText(/5\.2 km · 14 min · Road route/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.getByRole("heading", { name: "Where to?" })).toBeVisible();
  await page.getByLabel("Your name").fill("Test Rider");
  await page.getByLabel("Email").fill("rider@example.test");
  await page.getByLabel("Password").fill("a-long-password-123");
  await page.getByRole("button", { name: "Create passenger account" }).click();
  await expect(page.getByText(/Signed in as rider@example.test/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm ride request" }).click();
  await expect(page.getByText(/Ride request created/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText(/Ride request cancelled/)).toBeVisible();
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
  await expect(page.locator(".inline-notice")).toContainText(/invalid or expired quote/i);
  await expect(page.locator(".fare-amount")).toContainText("—");
});

test("route failures are honest and do not enable quote requests", async ({ page }) => {
  await page.route("https://nominatim.openstreetmap.org/search?**", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/");
  await expect(page.locator('.quote-details').getByText(/couldn't find/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Get server fare quote/ })).toBeDisabled();
  await expect(page.locator(".fare-amount")).toContainText("—");
});

test("booking page has no automated WCAG 2.2 AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockRouting(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /your next stop/i })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("quote rate limits are surfaced without pretending a booking succeeded", async ({ page }) => {
  await mockRouting(page);
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited" }) });
  });
  await page.goto("/");
  await expect(page.getByText(/5\.2 km · 14 min · Road route/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.locator(".inline-notice")).toContainText(/too many quote requests/i);
  await expect(page.locator(".fare-amount")).toContainText("—");
});

test("mobile booking layout has no horizontal page overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only viewport assertion");
  await mockRouting(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /your next stop/i })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});
