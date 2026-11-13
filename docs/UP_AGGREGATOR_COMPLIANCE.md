# India and Uttar Pradesh launch-compliance gate

**Research date:** 13 November 2026  
**Product:** RideForge, an academic/evaluation bike-taxi platform  
**Status:** Research checklist, not legal advice or a compliance certificate

RideForge must remain a non-operational demo until a qualified Indian transport/privacy counsel and the relevant transport authority confirm the operating model, licence, vehicle eligibility, safety obligations and data-processing controls. A working booking flow does not authorize carrying passengers.

## 1. Uttar Pradesh aggregator licensing

The Uttar Pradesh Motor Vehicle (Aggregator and Delivery Services Provider) Rules, 2026 establish a state framework for aggregators and delivery-service providers. The State Transport Authority is the relevant licensing authority; the official UP MV Aggregator and Delivery Service Provider portal is [upmyfleet.com](https://www.upmyfleet.com/).

A legal analysis of the final 2026 rules reports, among other requirements:

- The applicant must be a company under the Companies Act, an LLP, or a qualifying driver/vehicle-owner cooperative society, with a registered office in Uttar Pradesh. A student-owned demo or sole proprietorship should not assume it qualifies.
- A licence is valid for five years and is renewable for a further five years. The licensee must commence operations within six months of grant or risk cancellation.
- The rules prescribe an application fee of ₹25,000, a licence grant/renewal fee of ₹5,00,000 and a bank-guarantee security deposit. The published deposit bands range from ₹10,00,000 for fleets up to 1,000 non-bus vehicles to ₹50,00,000 for fleets above 10,000 non-bus vehicles, with an intermediate ₹25,00,000 band. Confirm the exact band, treatment of mixed vehicle categories and current portal calculation before applying.
- Existing operators were required to obtain a licence within 90 days of notification; that transition window has elapsed by this research date (13 November 2026). New aggregators must obtain the required licence before starting operations. The Government portal is live and lists the licensing workflow; confirm any current enforcement/regularization position directly with the State Transport Authority.
- The rules require a full-time Grievance Redressal Officer-cum-Compliance Officer with delegated authority/Power of Attorney, a two-way driver/passenger rating mechanism, fare-share disclosures, driver non-exclusivity, and a written commencement notice at least 72 hours before service begins.

The live UP portal's public workflow currently presents an eligibility check of operating more than 25 vehicles through a digital platform. The final-rule analysis and portal form should be reconciled with the applicant's intended fleet and business model; do not assume this portal-screen criterion is a statutory exemption for smaller operators or that a small pilot is outside the rules without written STA advice.

**Release gate:** obtain written confirmation of the exact applicant eligibility, licence class, licence and security-deposit amounts, Noida/NCR vehicle-category restrictions, and any current portal process from the State Transport Authority. Do not infer permission from the central guidelines alone.

Sources:
- [UP MV Aggregator and Delivery Service Provider portal — Government of Uttar Pradesh](https://www.upmyfleet.com/)
- [UP Motor Vehicle (Aggregator and Delivery Services Provider) Rules, 2026 — final-rule legal analysis and rule-by-rule summary (Argus Partners, 2 October 2026)](https://www.argus-p.com/updates/updates/overview-of-the-uttar-pradesh-motor-vehicle-thirty-third-amendment-aggregator-and-delivery-services-provider-rules-2026/)
- [UP MVADSP Portal — live licensing workflow and government contact details](https://www.upmyfleet.com/)
- [Official UP portal affidavit for licence applicants](https://upmyfleet.com/storage/affidavit/Affidavit.pdf)
- [MoRTH Motor Vehicle Aggregator Guidelines, 2025 (official PDF)](https://morth.nic.in/sites/default/files/circulars_document/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf)
- [CAQM Direction No. 94 and amendment dated 23 December 2025 (official CAQM PDF)](https://caqm.nic.in/FileUploadDomain/WebsiteDocument/Home/News/Direction%20and%20Amendmente738921f-1bba-445c-b837-6e794e066be4.pdf)

## 2. Bike-taxi and vehicle eligibility

The March 2026 government-hosted draft proposed a distinction between passenger and delivery use (transport motorcycles for passenger mobility; transport/non-transport motorcycles for hyperlocal delivery). Because that PDF is a draft and the final Gazette text must control, this precise vehicle-class interpretation remains a **written-confirmation gate** until counsel/STA checks the final notified text and any later amendments. Do not use the central guidelines as a substitute for the operative UP rules or treat an ordinary private motorcycle as eligible for paid passenger rides. Vehicle onboarding must meet the final state rules, permit/registration requirements and Motor Vehicles Act requirements.

The guidelines and the UP 2026 rules/legal analysis identify vehicle and safety controls that may include:

- Passenger motorcycles must be transport motorcycles; transport/non-transport motorcycles may be used for hyperlocal delivery only under the applicable conditions.
- Valid transport registration, any required contract-carriage permit, fitness certificate, third-party insurance with passenger cover, PUC, paid motor-vehicle taxes and cleared challans.
- Functional AIS-140-compliant vehicle location tracking and panic button connected to the aggregator control room and State Integrated Command and Control Centre; in-app trip tracking and route-deviation escalation also apply.
- Fire extinguisher, first-aid kit and functional speed governor as required for the vehicle category.
- A maximum vehicle age of 12 years, subject to stricter local fuel/permit conditions.
- Driver checks: UIDAI-backed Aadhaar verification, correct licence class, at least two years' driving experience, no specified convictions in the prior three years, medical/eyesight fitness, psychological evaluation by a registered psychiatrist, and police antecedent verification at least seven days before onboarding.
- Minimum 40-hour induction training, including at least six hours of first-responder training, defensive driving, route familiarisation, app use and gender/disability sensitisation; drivers below the fifth-percentile rating threshold must complete quarterly refresher training or cease providing service.
- Passenger insurance of at least ₹5 lakh; driver health insurance of at least ₹5 lakh and accidental/term cover of at least ₹10 lakh.

Noida is in the NCR. The UP 2026 rules' interaction with CAQM Direction 94 needs specific legal confirmation before selecting a fleet. The original CAQM Direction 94 restricted induction of conventional petrol/diesel two-wheelers from 1 January 2026. The official CAQM amendment dated 23 December 2025 permits BS-VI-standard two-wheelers to be inducted into an **existing fleet** through **31 December 2026**. The amendment's "existing fleet" wording must not be read as permission for a newly formed aggregator to induct BS-VI motorcycles; obtain written STA/CAQM clarification for RideForge's exact operator and fleet status. It is not a blanket permission for private motorcycles or a guarantee that the same category can be inducted from 1 January 2027. Noida and Greater Noida are explicitly identified as high-vehicle-density NCR cities. A privately registered motorcycle must not be treated as eligible for paid passenger rides merely because the app can onboard a driver.

**Release gate:** no real driver or vehicle onboarding until the vehicle class, transport registration, permit, insurance, AIS-140/panic-button requirements and NCR clean-fleet restrictions have been verified against the current official rules and the specific vehicle.

## 3. Driver and passenger obligations to operationalize

Before any real onboarding, obtain a counsel/authority-reviewed checklist for:

- Aadhaar/identity verification using an authorized process; never store Aadhaar images or numbers casually.
- Valid driving licence, required experience, police verification, medical/eyesight and psychological checks, and mandatory induction/refresher training.
- Health and accident/term insurance for drivers and passenger insurance.
- A 24x7 control room and call centre, escalation runbooks, emergency response ownership, Hindi/English support, and panic-button integration.
- Passenger live-location sharing, gender-based driver choice where required, grievance handling, two-way ratings and public fare-share disclosures.
- Driver non-exclusivity and the legally required driver fare share.
- Fare and cancellation policy controls aligned to the notified base fare (including the minimum 3 km base-fare basis), dynamic-pricing bounds of 50%–150%, minimum driver share of 80% for a driver using their own vehicle or 60% for an aggregator-owned vehicle, and cancellation penalties capped at ₹100 under the specified conditions.
- The state framework requires aggregators to increase electric, alternative-fuel or zero-emission vehicles by 5% annually. Outside the NCR, the legal analysis reports category-specific EV targets ranging from 1%–10% within the first six months to 15%–50% by the end of year five. In NCR districts, CAQM Direction 94 applies; the interaction between the 5% annual requirement and category targets needs authority clarification.

The current code's admin driver approval is an internal workflow only. It is not identity, police, medical, licence, vehicle, insurance or training verification. The support-report screen is not a staffed 24x7 call centre. A map marker is not an AIS-140 tracking/control-room integration. The app currently has no real-time government portal/VAHAN/SARATHI integration, no certified safety-device/panic-button telemetry, and no independent driver psych/medical or police-verification provider.

## 4. Fare and payout model

The UP 2026 legal analysis describes a regulated fare framework: the notified base fare applies with a minimum 3 km basis; dynamic pricing is bounded from 50% to 150% of base fare; drivers using their own vehicles receive at least 80% of the applicable fare (payable daily), while drivers of aggregator-owned vehicles receive at least 60%; and specified cancellation penalties are 10% of fare, capped at ₹100. Confirm the notified base-fare schedule and any subsequent amendments for the exact vehicle class before implementing a production tariff.

RideForge's current fare formula (demo base amount plus a per-kilometre amount) is illustrative only. It is not a state-notified fare schedule, a tax invoice, a driver earnings ledger or a payout record.

**Release gate:** replace the demo tariff with a versioned, authority-reviewed fare configuration; implement auditable driver/aggregator split, incentives, tax treatment, refunds, cancellation handling and payout reconciliation before accepting money or rides.

## 5. Cybersecurity and app obligations

The UP rules/legal analysis describes CERT-In-empanelled cybersecurity certification, required app/website disclosures, State Transport Portal integration, and retention/availability requirements for trip, passenger and fare records. The MoRTH 2025 guidelines also require compliance with applicable law and vehicle/driver safety requirements.

The repository's CI, CodeQL, dependency audit, container scan and automated accessibility checks are useful engineering evidence. They are not the required independent CERT-In-empanelled security certification, transport-authority approval or operational audit.

**Release gate:** commission the required independent security assessment, close all findings, document incident response and breach reporting, implement access-controlled audit exports, and confirm exact retention and lawful-disclosure rules with counsel.

## 6. DPDP Act and Rules — staggered commencement

The Digital Personal Data Protection Rules, 2025 and the commencement notification use staggered effective dates. The Gazette schedule sets some provisions to commence immediately, Rule 4 after one year, and a number of substantive Rules and Act provisions after eighteen months. On the 13 November 2025 Gazette schedule, those milestones fall on 13 November 2026 and 13 May 2027 respectively.

This does not mean RideForge should wait until 2027 to design privacy controls. The UP aggregator framework itself references applicable data-protection law, and the platform handles sensitive location and journey data. The UP rules require trip, passenger and fare data to be retained for a minimum of three months and a maximum of twelve months, with disclosure to the Transport Department only under due process and in accordance with the DPDP framework. As of 13 November 2026, the one-year DPDP commencement milestone (including Rule 4 and the specified Act clauses) has arrived; the eighteen-month tranche is scheduled for 13 May 2027. The commencement schedule is provision-specific, not a blanket deferral of all privacy obligations.

Minimum engineering controls before real user data:
- Explicit, purpose-specific notices and consent/other lawful-basis review.
- Data minimization; collect precise location only for a clear, bounded purpose.
- Retention schedules and deletion workflows for accounts, trips, support evidence and location history.
- Access logging, least privilege, encryption, secrets management and incident response.
- A process for data-principal requests, grievance handling and legally valid disclosures.
- A zero-tolerance on-duty alcohol/narcotics policy, with immediate off-boarding pending inquiry when the specified breach is detected.
- Processor/vendor agreements and a data-flow inventory covering hosting, maps, geocoding, analytics, messaging and payments.

Sources:
- [Digital Personal Data Protection Rules, 2025 — Gazette of India (MeitY PDF)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- [DPDP Act commencement notification — IndiaCode reproduction of Gazette text](https://egazette.gov.in/WriteReadData/2025/267647.pdf)

## 7. Open-source routing and map infrastructure

| Engine | Open-source license / useful capabilities | Fit for RideForge |
| --- | --- | --- |
| [Valhalla](https://github.com/valhalla/valhalla) | MIT; auto, bicycle, pedestrian, motor-scooter costing, route matrices, isochrones and map matching. The current documentation describes a dedicated `motor_scooter` costing model; motorcycle costing is marked beta. | **Preferred self-hosted evaluation candidate** for a bike-taxi product because motor-scooter access and speed preferences can be modelled. Pin a tested release (3.9.1 was current on 13 November 2026), use a regional OSM extract, and validate Noida's local access/one-way/turn restrictions with a route QA corpus. |
| [GraphHopper](https://github.com/graphhopper/graphhopper) | Apache-2.0; standalone Java server/library, motorcycle profile, turn costs, map matching, isochrones and route matrices. Some hosted Directions API features are commercial; do not confuse the hosted service with the open-source engine. | Strong alternative if the team wants a JVM service and custom motorcycle profiles. Validate the open-source feature set and licensing of every dependency before selecting it. |
| [OSRM](https://github.com/Project-OSRM/osrm-backend) | BSD-2-Clause; high-performance HTTP routing, table, trip, nearest, match and tile services; built-in car, bicycle and foot profiles, with custom Lua profiles possible. | Lowest-friction fit for the current backend because it already speaks OSRM's route API. Its default car profile is not a motorcycle-specific legal/access model; build and validate a dedicated profile before using it for bike-taxi dispatch. |
| [Nominatim](https://github.com/osm-search/Nominatim) | Open-source OSM geocoder; can be self-hosted with a PostGIS-backed OSM database and maintained imports. | Candidate for self-hosted place search. It needs ongoing import/update operations, storage, indexing, monitoring and a privacy/retention design. |

The backend currently expects an OSRM-compatible route response. Valhalla or GraphHopper cannot be selected by merely changing `RIDEFORGE_ROUTING_URL`: a provider adapter must normalize each engine's route metrics and geometry into the existing validated internal `ProviderRoute` contract, and its response fixtures/contract tests must cover malformed geometry, no-route, timeouts, rate limits and coordinate order. Do not replace the current provider until this adapter and Noida route acceptance corpus are tested. For bike-taxi route accuracy, compare at least 100 public Noida origin/destination pairs against known legal road paths and review restrictions, service roads, U-turns, flyovers and access tags with local domain reviewers.

**Geocoder options:** [Nominatim](https://github.com/osm-search/Nominatim) is the most direct self-hosted replacement for the current API contract and uses PostgreSQL/PostGIS plus osm2pgsql; its official install manual states 2 GB minimum RAM, with much larger resources for planet-scale imports. A regional Uttar Pradesh/NCR extract can reduce import size, but storage, updates and query quality still need benchmarking. [Photon](https://github.com/komoot/photon) (Apache-2.0) is an OSM geocoder built on OpenSearch, supports multilingual typo-tolerant search and location bias, and can import from a Nominatim database or JSON export; it is a good candidate if RideForge later needs self-hosted place suggestions. [Pelias](https://github.com/pelias/pelias) (MIT) is modular and Elasticsearch-based, with multiple importers and forward/reverse geocoding; it offers flexibility at higher operational complexity. For a single-city student MVP, do not deploy all three: start with a tested regional Nominatim instance or Photon, and only adopt Pelias if multiple data sources and custom venue ingestion justify its stack.

The current app uses Leaflet with public OSM raster tiles. This is suitable only for modest interactive evaluation traffic under the OSMF tile policy; it is not a commercial map-tile SLA. A production tile stack can use self-hosted vector/raster tiles or a contracted tile provider; routing, geocoding and map rendering are separate systems and each needs its own quota, attribution, cache and privacy controls.

- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) limits the public service to at most one request per second for the entire application, requires a meaningful User-Agent/Referer and attribution, and disallows client-side autocomplete and heavy/bulk use.
- [OSRM demo-server policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) limits the demo service to reasonable non-commercial use, at most one request per second, and offers no uptime/latency/data-freshness guarantees; access may be withdrawn.
- [OpenStreetMap raster tile policy](https://operations.osmfoundation.org/policies/tiles/) requires the exact tile.openstreetmap.org endpoint, visible attribution, valid browser Referer, caching according to HTTP headers (or at least seven days), and prohibits bulk/offline tile prefetching.

The browser should call RideForge's API rather than public Nominatim/OSRM directly. The current map uses standard OSM tiles only for the route currently being viewed; it must retain attribution, browser Referer and normal HTTP caching. The API's shared provider pacing is suitable for a single-instance evaluation demo; it is not a distributed rate limiter across multiple API replicas. Production must use a contracted provider or self-hosted routing/geocoding/tile capacity with monitored quotas, caching, attribution, and tested failover. Nominatim also prohibits personal/confidential data and client-side autocomplete; use only public landmarks/test locations in the demo, and use a contracted/self-hosted provider with appropriate privacy terms for real passenger addresses.

## 8. Product status and non-negotiable launch gates

| Area | Current repository status | Required before real rides |
| --- | --- | --- |
| Passenger/driver/admin workflow | Implemented as a portfolio MVP; CI-backed | Real-device journey and operational acceptance |
| Driver/vehicle verification | Not implemented as external verification | Authorized integrations and audited human review |
| Emergency response | No staffed 24x7 operation | Control room, panic integration, escalation and drills |
| Payments/refunds/payouts | Demo fare only | Licensed provider, ledger, reconciliation, refunds and payouts |
| Routing/geocoding | Public evaluation endpoints | Contract or self-hosted service and operational SLA |
| Privacy/retention | RLS and access controls exist; legal data governance incomplete | Data inventory, notices, deletion, retention and processor controls |
| Security certification | Automated CI scans/tests exist | Independent assessment by the required empanelled firm |
| Transport licensing | No RideForge licence claimed | STA licence and all category-specific approvals |
| Production hosting | Free-tier evaluation services | Always-on API/workers, durable database, monitoring and restore drills |

The rules also provide for a minimum fine of ₹25,000 and up to ₹1,00,000 for operating without a valid licence, suspension for up to three months, and in specified circumstances monetary penalties from ₹1,00,000 to ₹1,00,00,000, cancellation and security-deposit forfeiture. This makes an unlicensed production pilot a material business-continuity risk.

**Decision:** keep RideForge labelled as a demonstration/portfolio product. Do not enable real paid trips, onboard real drivers or collect real passenger location data until every applicable gate has written evidence and an accountable owner.

## 9. Source hierarchy and current portal cross-check — 13 November 2026

A source-quality distinction is important for this research:

- The Uttar Pradesh government-hosted PDF dated 13 March 2026 is explicitly a **draft notification inviting objections and suggestions**. It is useful for tracing the proposal, but it must not be cited as the final operative rule text. In particular, do not rely on draft clauses or draft EV percentages as the final law without checking the final Gazette.
- The final-rule date and operative framework are corroborated by the 2 October 2026 Argus Partners legal analysis, which identifies the Uttar Pradesh Motor Vehicle (Thirty-third Amendment) (Aggregator and Delivery Services Provider) Rules, 2026 as notified on 22 May 2026, and by the live Government of Uttar Pradesh MVADSP portal and its current applicant affidavit.
- The live portal currently advertises an eligibility check of operating **more than 25 vehicles through a digital platform**, an online licensing workflow, a five-year licence and VAHAN/SARATHI integration. Treat the portal's eligibility screen as an administrative application gate, not as a statutory exemption for platforms with 25 or fewer vehicles. Obtain written STA confirmation if the proposed fleet is below that threshold or the portal's interpretation conflicts with the final Gazette.
- The portal currently displays public aggregate figures (licensed aggregators, onboarded vehicles and fleet electrification). These are portal-reported figures, not an independent audit and not evidence that RideForge is eligible or licensed.
- The official portal affidavit expressly commits applicants to compliance with the UP 2026 rules, the DPDP Act, Consumer Protection Act and IT Act. This reinforces that a demo's technical controls cannot substitute for applicant eligibility, licence, documented operating processes or regulator approval.

**Noida-specific scope:** Noida and Greater Noida fall within the NCR context. The applicable UP aggregator rules and current CAQM directions must be checked together for the exact vehicle class and date of onboarding. The CAQM's December 2025 press release describes a proposed transitional treatment for BS-VI petrol two-wheelers in existing fleets through 31 December 2026; the release itself is not a substitute for the operative amendment text or a written determination for a new RideForge fleet. Do not infer that a newly formed operator can onboard a BS-VI petrol bike in Noida from the existing-fleet transition.

**Cross-border scope:** The Haryana Transport Department's official website lists an Aggregator Policy notification dated 21 May 2026. If RideForge later expands from Noida into Haryana (including Gurugram/Faridabad), perform a separate Haryana rule-by-rule review; UP licensing or UP vehicle approvals do not authorize Haryana operations. The product's current Noida configuration does not itself establish Haryana market entry.

Sources:
- [UP Government-hosted 13 March 2026 draft notification (draft only)](https://upidadv.up.gov.in/upload/PublicationRequest/183241/SachivalyaLKO130326Notification639090236220551079.pdf)
- [Government of Uttar Pradesh — UP MV Aggregator and Delivery Service Provider Scheme portal](https://www.upmyfleet.com/)
- [Government of Uttar Pradesh — applicant compliance affidavit](https://upmyfleet.com/storage/affidavit/Affidavit.pdf)
- [Argus Partners — final-rule analysis, 2 October 2026](https://www.argus-p.com/updates/updates/overview-of-the-uttar-pradesh-motor-vehicle-thirty-third-amendment-aggregator-and-delivery-services-provider-rules-2026/)
- [Haryana Transport Department — official notices, including Aggregator Policy dated 21 May 2026](https://www.haryanatransport.gov.in/en/whats-news)
- [CAQM — 22 December 2025 press release on Direction 94 amendment deliberations](https://caqm.nic.in/WriteReadData/LINKS/CAQM%20PR%2023b05acfe5-5b91-477b-937b-dee37eb33da1.pdf)

This section is a research cross-check, not a legal opinion. The final Gazette text, later amendments, portal instructions and written STA/CAQM interpretations prevail over this summary.
