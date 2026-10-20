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
  await expect(page.getByRole("application", { name: /Interactive road map from/ })).toBeVisible();
  await expect(page.locator("#route-map-description")).toContainText("route distance, estimated duration and fare");
  await expect(page.locator(".leaflet-control-attribution a[href*='openstreetmap.org/copyright']")).toBeVisible();
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
  let bookingAttempts = 0;
  let firstIdempotencyKey = "";
  await page.route("http://api.test/api/v1/rides", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-access-token");
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rides: [{
        rideId: "30000000-0000-4000-8000-000000000001", status: "completed",
        pickup: "JIIT Sector 128", destination: "Sector 18 Market", farePaise: 4750,
        finalFarePaise: 4750, currency: "INR", createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      }] }) });
      return;
    }
    const key = route.request().headers()["idempotency-key"] ?? "";
    expect(key).toContain("rideforge-");
    if (bookingAttempts === 0) {
      firstIdempotencyKey = key;
      bookingAttempts += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "booking_unavailable" }) });
      return;
    }
    expect(key).toBe(firstIdempotencyKey);
    bookingAttempts += 1;
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
  const report = {
    id: "42", rideId: "30000000-0000-4000-8000-000000000001", category: "technical",
    description: "The booking status did not refresh after reconnecting.", status: "open",
    resolutionNote: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null,
  };
  await page.route("http://api.test/api/v1/support/reports", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-access-token");
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ rideId: report.rideId, category: "technical" });
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(report) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reports: [report] }) });
    }
  });

  await page.goto("/");
  await expect(page.getByText(/5\.2 km · 14 min · Road route/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await expect(page.getByRole("heading", { name: "Where to?" })).toBeVisible();
  await page.getByLabel("Your name").fill("Test Rider");
  await page.locator(".auth-panel input[type=\"email\"]").first().fill("rider@example.test");
  await page.locator(".auth-panel input[type=\"password\"]").first().fill("a-long-password-123");
  await page.getByRole("button", { name: "Create passenger account" }).click();
  await expect(page.locator('.auth-session')).toBeVisible();
  await page.getByRole("button", { name: "Confirm ride request" }).click();
  await expect(page.locator(".inline-notice").filter({ hasText: /booking_unavailable/i })).toBeVisible();
  await page.getByRole("button", { name: "Confirm ride request" }).click();
  await expect(page.locator(".ride-confirmation")).toBeVisible();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText(/Ride request cancelled/)).toBeVisible();
  await page.getByLabel(/Describe the issue/).fill(report.description);
  await page.getByRole("button", { name: /Submit support report/ }).click();
  await expect(page.locator(".inline-notice")).toContainText(/Support report submitted/);
  await expect(page.getByText("#42 · technical")).toBeVisible();
  await page.getByRole("button", { name: /Refresh trip history/ }).click();
  await expect(page.getByText("Trip history refreshed from the API.")).toBeVisible();
  await expect(page.getByText("JIIT Sector 128 → Sector 18 Market")).toBeVisible();
  await page.getByRole("button", { name: "View demo receipt" }).click();
  await expect(page.getByRole("heading", { name: "Trip receipt" })).toBeVisible();
  await expect(page.getByText(/Not a tax invoice/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible();
});

test("passenger ride status refreshes from persisted API state", async ({ page }) => {
  await page.clock.install();
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
      accessToken: "polling-passenger-token",
      account: { email: "polling@example.test", displayName: "Polling Rider", role: "passenger" },
    }) });
  });
  await page.route("http://api.test/api/v1/rides", async route => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000099", status: "requested",
    }) });
  });
  let reads = 0;
  await page.route("http://api.test/api/v1/rides/30000000-0000-4000-8000-000000000099", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer polling-passenger-token");
    reads += 1;
    const status = reads === 1 ? "requested" : reads === 2 ? "assigned" : "in_progress";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000099", status,
      ...(status === "assigned" || status === "in_progress" ? {
        driverLocation: { latitude: 28.54, longitude: 77.34, updatedAt: new Date().toISOString() },
      } : {}),
    }) });
  });

  await page.goto("/");
  await expect(page.getByText("5.2 km · 14 min · Road route")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await page.getByLabel("Your name").fill("Polling Rider");
  await page.locator('.auth-panel input[type="email"]').first().fill("polling@example.test");
  await page.locator('.auth-panel input[type="password"]').first().fill("a-long-password-123");
  await page.getByRole("button", { name: "Create passenger account" }).click();
  await page.getByRole("button", { name: "Confirm ride request" }).click();
  await expect(page.locator(".ride-confirmation")).toContainText("Status: requested");
  await expect.poll(() => reads).toBeGreaterThan(0);
  await page.clock.fastForward(5000);
  await expect(page.locator(".ride-confirmation")).toContainText("Status: assigned");
  await expect(page.getByRole("application", { name: /Includes the driver’s latest reported location/ })).toBeVisible();
  await page.clock.fastForward(5000);
  await expect(page.locator(".ride-confirmation")).toContainText("Status: in_progress");
  await expect(page.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
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

test("driver workspace uses protected API routes for availability and ride lifecycle", async ({ page }) => {
  await page.route("http://api.test/api/v1/auth/login", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      accessToken: "driver-access-token", account: { email: "driver@example.test", role: "driver" },
    }) });
  });
  await page.route("http://api.test/api/v1/driver/availability", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer driver-access-token");
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    expect(body.latitude).toBe(28.53);
    expect(body.longitude).toBe(77.35);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ online: true, updated: true }) });
  });
  await page.route("http://api.test/api/v1/driver/rides", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rides: [{
      rideId: "30000000-0000-4000-8000-000000000001", pickup: "Pickup", destination: "Destination",
      farePaise: 4750, distanceMeters: 5200,
    }] }) });
  });
  await page.route("http://api.test/api/v1/driver/rides/history", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer driver-access-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      rides: [{ rideId: "30000000-0000-4000-8000-000000000001", status: "completed", pickup: "Pickup", destination: "Destination", farePaise: 4750, finalFarePaise: 4750, createdAt: new Date().toISOString() }],
      grossCompletedFarePaise: 4750, currency: "INR", note: "Gross completed fares only; this is not a payout or net-earnings ledger.",
    }) });
  });
  await page.route("http://api.test/api/v1/driver/rides/*/accept", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer driver-access-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000001", status: "assigned",
    }) });
  });
  await page.route("http://api.test/api/v1/driver/rides/*/status", async route => {
    const status = route.request().postDataJSON().status;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000001", status,
    }) });
  });

  await page.goto("/");
  const openDriverNav = page.getByRole("button", { name: "Open navigation" });
  if ((page.viewportSize()?.width ?? 1024) <= 768) await openDriverNav.click();
  await page.getByRole("button", { name: "Drive with us" }).click();
  await page.locator("#operations").getByLabel("Email").fill("driver@example.test");
  await page.locator("#operations").getByLabel("Password").fill("driver-password");
  await page.locator("#operations").getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "Availability and rides" })).toBeVisible();
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 28.53, longitude: 77.35 });
  await page.getByRole("button", { name: /Use my location and go online/ }).click();
  await page.getByRole("button", { name: "Refresh ride queue" }).click();
  await expect(page.getByText("Pickup → Destination")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Status: assigned")).toBeVisible();
  await page.getByRole("button", { name: "Mark arriving" }).click();
  await expect(page.getByText("Status: driver_arriving")).toBeVisible();
  await page.getByRole("button", { name: "Start trip" }).click();
  await expect(page.getByText("Status: in_progress")).toBeVisible();
  await page.getByRole("button", { name: "Complete trip" }).click();
  await expect(page.getByText("Status: completed")).toBeVisible();
  await page.getByRole("button", { name: /Refresh trip history/ }).click();
  await expect(page.getByText("Gross completed fares:")).toBeVisible();
  await expect(page.locator("#operations .driver-queue").filter({ hasText: "Gross completed fares:" }).getByText("₹47.50", { exact: true })).toBeVisible();
  await expect(page.getByText(/not a payout or net-earnings ledger/)).toBeVisible();
});

test("admin workspace reads metrics from the protected API", async ({ page }) => {
  await page.route("http://api.test/api/v1/auth/login", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      accessToken: "admin-access-token", account: { email: "admin@example.test", role: "admin" },
    }) });
  });
  await page.route("http://api.test/api/v1/admin/metrics", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer admin-access-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ridesByStatus: { requested: 3, completed: 2 }, onlineDrivers: 4,
      pendingOutboxEvents: 5, deadLetteredOutboxEvents: 1, oldestPendingOutboxAgeSeconds: 240,
    }) });
  });
  await page.goto("/");
  const openAdminNav = page.getByRole("button", { name: "Open navigation" });
  if ((page.viewportSize()?.width ?? 1024) <= 768) await openAdminNav.click();
  await page.getByRole("button", { name: "Admin console" }).click();
  await page.locator("#operations").getByLabel("Email").fill("admin@example.test");
  await page.locator("#operations").getByLabel("Password").fill("admin-password");
  await page.locator("#operations").getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(page.getByText("Online drivers:")).toBeVisible();
  await expect(page.getByText(/Online drivers:\s*4/)).toBeVisible();
  await expect(page.getByText(/Outbox backlog:\s*5 pending · 1 dead-lettered · oldest pending 240s/)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Dead-lettered ride events need operator review");
  await expect(page.getByText("requested", { exact: true })).toBeVisible();
});


test("admin provisions a driver and explicitly approves or suspends dispatch eligibility", async ({ page }) => {
  await mockRouting(page);
  const drivers: Array<{
    driverId: string; email: string; displayName: string; vehicleRegistration: string;
    approved: boolean; online: boolean; createdAt: string;
  }> = [];
  const supportReports: Array<{
    id: string; rideId: string | null; category: string; description: string; status: string;
    resolutionNote: string; createdAt: string; updatedAt: string; resolvedAt: string | null;
    reporterId: string; reporterEmail: string; reporterName: string;
  }> = [{
    id: "42", rideId: null, category: "technical",
    description: "A trip status failed to refresh after reconnecting.",
    status: "open", resolutionNote: "", createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), resolvedAt: null,
    reporterId: "passenger-1", reporterEmail: "rider@example.test", reporterName: "Demo Rider",
  }];
  await page.route("http://api.test/api/v1/auth/login", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      accessToken: "test-admin-token",
      account: { email: "admin@example.test", role: "admin" },
    }) });
  });
  await page.route("http://api.test/api/v1/admin/audit?limit=50", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-admin-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [{
      id: "audit-1", actorEmail: "admin@example.test", action: "driver.approved",
      targetType: "driver", targetId: "driver-test-0001", details: { approved: true },
      createdAt: new Date().toISOString(),
    }] }) });
  });
  await page.route("http://api.test/api/v1/admin/rides**", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-admin-token");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rides: [{
      rideId: "ride-test-0001", status: "completed", passengerEmail: "rider@example.test",
      driverEmail: "driver@example.test", pickup: "JIIT Sector 128", destination: "Sector 18 Market",
      farePaise: 4750, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }], limit: 100 }) });
  });
  await page.route("http://api.test/api/v1/admin/support-reports**", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-admin-token");
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reports: supportReports }) });
      return;
    }
    const input = route.request().postDataJSON() as { status: string; resolutionNote?: string };
    supportReports[0].status = input.status;
    supportReports[0].resolutionNote = input.resolutionNote ?? "";
    supportReports[0].updatedAt = new Date().toISOString();
    supportReports[0].resolvedAt = input.status === "resolved" || input.status === "rejected" ? new Date().toISOString() : null;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(supportReports[0]) });
  });
  await page.route("http://api.test/api/v1/admin/drivers**", async route => {
    const request = route.request();
    expect(request.headers()["authorization"]).toBe("Bearer test-admin-token");
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drivers }) });
      return;
    }
    if (request.method() === "POST") {
      const input = request.postDataJSON() as { email: string; displayName: string; vehicleRegistration: string };
      const driver = {
        driverId: "driver-test-0001",
        email: input.email,
        displayName: input.displayName,
        vehicleRegistration: input.vehicleRegistration.toUpperCase(),
        approved: false,
        online: false,
        createdAt: new Date().toISOString(),
      };
      drivers.push(driver);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(driver) });
      return;
    }
    if (request.method() === "PUT") {
      const driver = drivers[0];
      driver.approved = (request.postDataJSON() as { approved: boolean }).approved;
      driver.online = false;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        driverId: driver.driverId, approved: driver.approved, online: false,
      }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "method_not_allowed" }) });
  });

  await page.goto("/");
  const openAdminNav = page.getByRole("button", { name: "Open navigation" });
  if ((page.viewportSize()?.width ?? 1024) <= 768) await openAdminNav.click();
  await page.getByRole("button", { name: "Admin console" }).click();
  await page.locator("#operations").getByLabel("Email").fill("admin@example.test");
  await page.locator("#operations").getByLabel("Password").fill("a-long-admin-password-123");
  await page.locator("#operations").getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("heading", { name: "Operations and driver approval" })).toBeVisible();
  await page.getByRole("button", { name: /Refresh drivers/ }).click();
  await page.locator("#operations").getByLabel("Driver name").fill("Demo Driver");
  await page.locator("#operations").getByLabel("Email", { exact: true }).fill("driver@example.test");
  await page.locator("#operations").getByLabel("Temporary password (12+ characters)").fill("a-long-driver-password-123");
  await page.locator("#operations").getByLabel("Vehicle registration").fill("HR-00-DEMO-01");
  const createDriverButton = page.locator("#operations").getByRole("button", { name: /Create pending driver/ });
  await expect(createDriverButton).toBeEnabled();
  await createDriverButton.click();
  await expect(page.getByText("Pending approval")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => drivers[0]?.approved).toBe(true);
  await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();
  await page.getByRole("button", { name: /Refresh audit history/ }).click();
  await expect(page.getByText("driver approved", { exact: true })).toBeVisible();
  await expect(page.getByText("admin@example.test · driver · driver-test-0001")).toBeVisible();
  await page.getByRole("button", { name: /Refresh reports/ }).click();
  await expect(page.getByText("#42 · technical · open")).toBeVisible();
  await page.getByLabel("Resolution note (required to resolve/reject)").fill("Reviewed the event and documented the recovery steps.");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("#42 · technical · resolved")).toBeVisible();
  await page.getByLabel("Ride ID, passenger/driver email, or pickup/drop-off").fill("ride-test-0001");
  await page.getByRole("button", { name: /Search rides/ }).click();
  await expect(page.getByText("ride-test-0001")).toBeVisible();
  await expect(page.getByText("rider@example.test")).toBeVisible();
});


test("driver uses browser geolocation, refreshes availability, and goes offline on sign-out", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 28.53, longitude: 77.35 });
  await page.route("http://api.test/api/v1/auth/login", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      accessToken: "test-driver-token",
      account: { email: "driver@example.test", role: "driver" },
    }) });
  });
  const availability: Array<{ online: boolean; latitude?: number; longitude?: number }> = [];
  await page.route("http://api.test/api/v1/driver/availability", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer test-driver-token");
    availability.push(route.request().postDataJSON() as { online: boolean; latitude: number; longitude: number });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: true }) });
  });
  await page.route("http://api.test/api/v1/driver/rides", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rides: [] }) });
  });

  await page.goto("/");
  const openDriverNav = page.getByRole("button", { name: "Open navigation" });
  if ((page.viewportSize()?.width ?? 1024) <= 768) await openDriverNav.click();
  await page.getByRole("button", { name: "Drive with us" }).click();
  await page.locator('.auth-panel input[type="email"]').first().fill("driver@example.test");
  await page.locator('.auth-panel input[type="password"]').first().fill("a-long-driver-password-123");
  await page.locator("#operations").getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: /Use my location and go online/ }).click();
  await expect(page.getByRole("button", { name: "Go offline" })).toBeVisible();
  expect(availability[0]).toMatchObject({ online: true, latitude: 28.53, longitude: 77.35 });
  await page.context().setGeolocation({ latitude: 28.531, longitude: 77.351 });
  await page.getByRole("button", { name: "Refresh my location" }).click();
  await expect.poll(() => availability.some(item =>
    item.online && item.latitude === 28.531 && item.longitude === 77.351
  ), { timeout: 5000 }).toBe(true);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#operations").getByRole("button", { name: "Sign in securely" })).toBeVisible();
  expect(availability.at(-1)).toEqual({ online: false });
});


test("passenger applies authenticated server-sent ride events without waiting for polling", async ({ page }) => {
  await page.clock.install();
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
      accessToken: "sse-passenger-token",
      account: { email: "sse@example.test", displayName: "SSE Rider", role: "passenger" },
    }) });
  });
  await page.route("http://api.test/api/v1/rides", async route => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000077", status: "requested",
    }) });
  });
  await page.route("http://api.test/api/v1/rides/30000000-0000-4000-8000-000000000077", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      rideId: "30000000-0000-4000-8000-000000000077", status: "requested",
    }) });
  });
  let streamRequests = 0;
  await page.route("http://api.test/api/v1/rides/30000000-0000-4000-8000-000000000077/events", async route => {
    streamRequests += 1;
    expect(route.request().headers()["authorization"]).toBe("Bearer sse-passenger-token");
    if (streamRequests > 1) { await route.abort(); return; }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      body: 'id: 12\nevent: ride-status\ndata: {"eventId":12,"rideId":"30000000-0000-4000-8000-000000000077","status":"assigned","createdAt":"2026-10-18T00:00:00Z"}\n\n',
    });
  });

  await page.goto("/");
  await expect(page.getByText("5.2 km · 14 min · Road route")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await page.getByLabel("Your name").fill("SSE Rider");
  await page.locator('.auth-panel input[type="email"]').first().fill("sse@example.test");
  await page.locator('.auth-panel input[type="password"]').first().fill("a-long-password-123");
  await page.getByRole("button", { name: "Create passenger account" }).click();
  await page.getByRole("button", { name: "Confirm ride request" }).click();
  await expect(page.locator(".ride-confirmation")).toContainText("Status: assigned", { timeout: 5000 });
  expect(streamRequests).toBeGreaterThan(0);
  // A stale REST read must not roll the state back after a newer SSE event.
  await page.clock.fastForward(5000);
  await expect(page.locator(".ride-confirmation")).toContainText("Status: assigned");
});
