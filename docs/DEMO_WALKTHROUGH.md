# RideForge demo walkthrough

This guide demonstrates the **portfolio MVP** locally. It is not a commercial ride service, and the demo receipt is not proof of payment or a tax invoice.

## 1. Start the application

Requirements: Docker Engine and Docker Compose, a browser with JavaScript enabled, and network access to the configured geocoding/routing provider.

```sh
cp .env.example .env
```

Edit `.env` and replace all placeholder secrets. Use a unique local password and a random JWT secret of at least 32 characters. Do not commit `.env`.

```sh
docker compose up --build
```

Wait until the API health check passes, then open [http://localhost:5173](http://localhost:5173). Verify [API readiness](http://localhost:8080/api/v1/ready) returns `{"status":"ready"}`.

The browser app uses the API at `http://localhost:8080`. The API requires PostgreSQL migrations and the outbox worker; Compose starts both. The default public Nominatim/OSRM endpoints are for evaluation only and may rate-limit or be unavailable.

## 2. Create the first administrator

In a separate terminal, follow the safe one-time bootstrap flow from the [operations runbook](OPERATIONS_RUNBOOK.md#create-the-first-local-administrator). The password is read from standard input; do not put it in shell arguments or commit it.

Sign in to the Operations area with that admin account. Admin creation is not exposed as a public API operation.

## 3. Provision and approve a demo driver

In the admin workspace:

1. Create a driver with a unique email, a strong temporary password, a display name, and a demo vehicle registration.
2. Approve the driver explicitly.
3. Confirm the audit history records provisioning and approval.

This workflow is a demo trust gate only; it does not verify a real driver's identity, licence, insurance or vehicle documents.

## 4. Complete a passenger-to-driver ride

Use two browser contexts or browsers so the passenger and driver sessions remain separate.

1. In the passenger browser, register a passenger account.
2. Choose pickup and destination addresses. You can use the current-location action if the browser grants location permission, or enter a pickup address manually.
3. You can also choose **Choose pickup on map** or **Choose destination on map**, then click the interactive map. The selected point is reverse-geocoded into an address before the route is recalculated. Wait for the API to return a valid road-route quote. Check the route distance, duration, fare, and quote expiry. If routing fails, the app should show an error instead of inventing a fare.
4. Submit the booking and wait for server confirmation. Refresh the page and verify the persisted ride still appears in trip history.
5. In the driver browser, sign in with the provisioned driver account. Grant browser geolocation and choose **Use my location and go online**. The demo dispatch policy requires an approved driver, a location updated within five minutes, no other active ride, and pickup coordinates inside the configured great-circle radius (20 km by default).
6. Refresh the driver queue and accept the ride. If the pickup is outside the radius or another driver wins the race, the API must reject the acceptance.
7. Advance the ride through driver arriving, in progress and completed using the driver workspace. Ride status changes are persisted and sent through authenticated server-sent events; REST reads recover state after reconnect.
8. Return to the passenger browser. Confirm the state updates, open trip history, and print the demo receipt. A driver's location is a last-reported position refreshed roughly once per minute while online—not continuous high-frequency tracking or navigation.

## 5. Verify the admin/support workflows

- Use admin ride search to inspect the ride and assignment.
- Inspect audit history for privileged actions.
- Submit a support report from a signed-in passenger or driver, then review and resolve it from the admin workspace.
- Check the admin outbox metrics. Any dead-lettered events require operator investigation.

A safety-category support report is **not** an emergency-service dispatch. The app does not promise a staffed response or contact emergency services.

## 6. Reproduce the automated verification

The full release-readiness workflow can be started from GitHub Actions using **Run workflow** on `feat/rideforge-release-candidate`. Record the exact commit SHA and require all eight jobs to pass on that same SHA. The workflow covers native C++ tests/sanitizers/benchmarks, API/PostgreSQL integration, Playwright/axe, Compose, dependency audit, CodeQL and container vulnerability scanning.

For local database recovery scripts, read the [backup and restore runbook](OPERATIONS_RUNBOOK.md#backup-and-restore). Only restore into a dedicated empty test database until a reviewed production recovery procedure exists.

## Known limitations

- The driver manually accepts requests; this is not autonomous dispatch or a real fleet operation.
- Dispatch ranking uses pickup distance, not traffic-aware road ETA.
- Demo fare is a sample tariff; payment, refund, reconciliation and driver payout are not implemented.
- Public routing/geocoding services are not a production SLA.
- Local Compose is a reproducible evaluation environment, not a deployed production service.
- Real driver/vehicle verification, staffed safety/support operations, legal transport permissions and production privacy/security review are prerequisites for commercial use.
