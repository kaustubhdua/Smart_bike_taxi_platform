import { expect, test, type Page } from "@playwright/test";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type,idempotency-key,last-event-id",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS",
};

const quoteResponse = {
  quoteId: "2a4e1bb0-4ed9-4bb2-a5a2-44f2f4ed8f4d",
  distanceKm: 9.753,
  durationMinutes: 15,
  farePaise: 12728,
  fareBreakdown: {
    baseFarePaise: 2000,
    distanceFarePaise: 10728,
    pricingModel: "demo_base_plus_distance",
  },
  currency: "INR",
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  geometry: [[77.3659633, 28.5193178], [77.35, 28.54], [77.3228443, 28.5702711]],
};

async function mockHealth(page: Page) {
  await page.route("http://api.test/api/v1/health", route =>
    route.fulfill({ status: 200, headers: corsHeaders, contentType: "application/json", body: JSON.stringify({ status: "ok", backend: "supabase" }) }),
  );
}

async function mockPhotonSearch(page: Page, onRequest?: (query: string) => void) {
  await page.route("https://photon.komoot.io/api/**", async route => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    onRequest?.(query);
    const pickup = query.toLowerCase().includes("jiit");
    const coordinates = pickup ? [77.3659633, 28.5193178] : [77.3228443, 28.5702711];
    const properties = pickup
      ? { name: "JIIT Sector 128", city: "Noida", state: "Uttar Pradesh", country: "India" }
      : { name: "Sector 18 Market", city: "Noida", state: "Uttar Pradesh", country: "India" };
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties, geometry: { type: "Point", coordinates } }],
      }),
    });
  });
}

async function fillJourney(page: Page) {
  await page.getByRole("combobox", { name: "Pickup point" }).fill("JIIT Sector 128, Noida");
  await page.getByRole("combobox", { name: "Drop-off point" }).fill("Sector 18 Market, Noida");
}

test("geocodes only on quote request and sends coordinates for server-side fare calculation", async ({ page }) => {
  let geocodingRequests = 0;
  let quotePayload: Record<string, any> | undefined;
  await mockHealth(page);
  await mockPhotonSearch(page, () => { geocodingRequests += 1; });
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }
    quotePayload = route.request().postDataJSON() as Record<string, any>;
    await route.fulfill({ status: 200, headers: corsHeaders, contentType: "application/json", body: JSON.stringify(quoteResponse) });
  });
  await page.route("https://*.tile.openstreetmap.org/**", route => route.abort());

  await page.goto("/passenger");
  await fillJourney(page);
  expect(geocodingRequests).toBe(0);

  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.locator(".fare-amount")).toContainText("₹127.28", { timeout: 15_000 });
  await expect(page.getByText("Route found")).toBeVisible();
  await expect(page.getByText("Base fare")).toBeVisible();
  await expect(page.getByText("₹20.00")).toBeVisible();
  await expect(page.getByText("₹107.28")).toBeVisible();
  await expect.poll(() => geocodingRequests).toBe(2);

  expect(quotePayload?.pickup).toMatchObject({
    label: "JIIT Sector 128, Noida",
    latitude: 28.5193178,
    longitude: 77.3659633,
  });
  expect(quotePayload?.destination).toMatchObject({
    label: "Sector 18 Market, Noida",
    latitude: 28.5702711,
    longitude: 77.3228443,
  });
  expect(quotePayload).not.toHaveProperty("farePaise");
  expect(quotePayload).not.toHaveProperty("distanceKm");
});

test("does not display a fare when browser geocoding fails", async ({ page }) => {
  let quoteRequests = 0;
  await mockHealth(page);
  await page.route("https://photon.komoot.io/api/**", route =>
    route.fulfill({ status: 403, headers: corsHeaders, contentType: "text/plain", body: "Forbidden" }),
  );
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    quoteRequests += 1;
    await route.fulfill({ status: 500, headers: corsHeaders, contentType: "application/json", body: JSON.stringify({ error: "unexpected" }) });
  });
  await page.route("https://*.tile.openstreetmap.org/**", route => route.abort());

  await page.goto("/passenger");
  await fillJourney(page);
  await page.getByRole("button", { name: /Get server fare quote/ }).click();

  await expect(page.locator(".quote-details").getByText(/Address lookup is temporarily unavailable/)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".fare-amount")).toContainText("—");
  expect(quoteRequests).toBe(0);
});

test("uses GPS coordinates even if reverse address lookup is unavailable", async ({ page }) => {
  let quotePayload: Record<string, any> | undefined;
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 28.5193178, longitude: 77.3659633 });
  await mockHealth(page);
  await page.route("https://photon.komoot.io/reverse**", route =>
    route.fulfill({ status: 503, headers: corsHeaders, contentType: "application/json", body: JSON.stringify({ error: true }) }),
  );
  await mockPhotonSearch(page);
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }
    quotePayload = route.request().postDataJSON() as Record<string, any>;
    await route.fulfill({ status: 200, headers: corsHeaders, contentType: "application/json", body: JSON.stringify(quoteResponse) });
  });
  await page.route("https://*.tile.openstreetmap.org/**", route => route.abort());

  await page.goto("/passenger");
  await page.getByRole("button", { name: /Use my current location/ }).click();
  await expect(page.getByRole("combobox", { name: "Pickup point" })).toHaveValue("Current GPS location");
  await page.getByRole("combobox", { name: "Drop-off point" }).fill("Sector 18 Market, Noida");
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.locator(".fare-amount")).toContainText("₹127.28", { timeout: 15_000 });
  expect(quotePayload?.pickup).toMatchObject({
    latitude: 28.5193178,
    longitude: 77.3659633,
  });
});
