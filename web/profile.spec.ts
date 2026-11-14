import { expect, test } from "@playwright/test";

test("passenger can read the authenticated profile and update their display name", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", route => route.abort());
  await page.route("http://api.test/api/v1/routes/quote", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        quoteId: "2a4e1bb0-4ed9-4bb2-a5a2-44f2f4ed8f4d",
        distanceKm: 5.2,
        durationMinutes: 14,
        farePaise: 7720,
        fareBreakdown: { baseFarePaise: 2000, distanceFarePaise: 5720, pricingModel: "demo_base_plus_distance" },
        currency: "INR",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        geometry: [[77.33, 28.53], [77.34, 28.54], [77.35, 28.55]],
      }),
    });
  });
  await page.route("http://api.test/api/v1/auth/register", async route => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "profile-test-token",
        account: {
          id: "30000000-0000-4000-8000-000000000099",
          email: "profile@example.test",
          displayName: "Profile Rider",
          role: "passenger",
        },
      }),
    });
  });
  let profileUpdates = 0;
  await page.route("http://api.test/api/v1/me", async route => {
    expect(route.request().headers()["authorization"]).toBe("Bearer profile-test-token");
    if (route.request().method() !== "PATCH") {
      await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "method_not_allowed" }) });
      return;
    }
    profileUpdates += 1;
    expect(route.request().postDataJSON()).toEqual({ displayName: "Updated Profile Rider" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "30000000-0000-4000-8000-000000000099",
        email: "profile@example.test",
        displayName: "Updated Profile Rider",
        role: "passenger",
      }),
    });
  });

  await page.goto("/live");
  await page.getByRole("button", { name: /Get server fare quote/ }).click();
  await page.getByLabel("Your name").fill("Profile Rider");
  await page.locator('.auth-panel input[type="email"]').first().fill("profile@example.test");
  await page.locator('.auth-panel input[type="password"]').first().fill("a-long-profile-password-123");
  await page.getByRole("button", { name: "Create passenger account" }).click();

  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("Profile Rider");
  await page.getByLabel("Display name").fill("Updated Profile Rider");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator(".inline-notice")).toContainText("Your profile was updated");
  await expect(page.getByLabel("Display name")).toHaveValue("Updated Profile Rider");
  expect(profileUpdates).toBe(1);
  await expect(page.getByText(/Phone verification.*not configured/i)).toBeVisible();
});
