# India and Uttar Pradesh launch-compliance gate

**Research date:** 13 November 2026  
**Product:** RideForge, an academic/evaluation bike-taxi platform  
**Status:** Research checklist, not legal advice or a compliance certificate

RideForge must remain a non-operational demo until a qualified Indian transport/privacy counsel and the relevant transport authority confirm the operating model, licence, vehicle eligibility, safety obligations and data-processing controls. A working booking flow does not authorize carrying passengers.

## 1. Uttar Pradesh aggregator licensing

The Uttar Pradesh Motor Vehicle (Aggregator and Delivery Services Provider) Rules, 2026 establish a state framework for aggregators and delivery-service providers. The State Transport Authority is the relevant licensing authority; the official UP MV Aggregator and Delivery Service Provider portal is [upmyfleet.com](https://www.upmyfleet.com/).

A legal analysis of the final 2026 rules reports, among other requirements:

- An eligible applicant is a company, LLP or cooperative society with a registered office in Uttar Pradesh.
- The applicant must be a company under the Companies Act, an LLP, or a qualifying driver/vehicle-owner cooperative society, and must have an office in Uttar Pradesh. A student-owned demo or sole proprietorship should not assume it qualifies.
- The rules prescribe an application fee of ₹25,000, a licence grant/renewal fee of ₹5,00,000 and a bank-guarantee security deposit. The published deposit bands range from ₹10,00,000 for fleets up to 1,000 non-bus vehicles to ₹50,00,000 for fleets above 10,000 non-bus vehicles, with an intermediate ₹25,00,000 band. Confirm the exact band, treatment of mixed vehicle categories and current portal calculation before applying.
- Existing operators were required to obtain a licence within 90 days of notification; that transition window has elapsed by this research date (13 November 2026). New aggregators must obtain the required licence before starting operations. The Government portal is live and lists the licensing workflow; confirm any current enforcement/regularization position directly with the State Transport Authority.
- The rules require a full-time Grievance Redressal Officer-cum-Compliance Officer, a two-way driver/passenger rating mechanism, fare-share disclosures, driver non-exclusivity, and a written commencement notice at least 72 hours before service begins.

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

The UP rule text distinguishes passenger and delivery use: aggregation of **transport motorcycles** is permitted for passenger mobility, while transport and non-transport motorcycles may be aggregated for **hyperlocal delivery**. Do not use the central guidelines as a substitute for this state-specific rule or treat an ordinary private motorcycle as eligible for paid passenger rides. Vehicle onboarding must meet the state rules and Motor Vehicles Act requirements.

The guidelines and the UP 2026 rules/legal analysis identify vehicle and safety controls that may include:

- Passenger motorcycles must be transport motorcycles; transport/non-transport motorcycles may be used for hyperlocal delivery only under the applicable conditions.
- Valid transport registration, any required contract-carriage permit, fitness certificate, third-party insurance with passenger cover, PUC, paid motor-vehicle taxes and cleared challans.
- Functional AIS-140-compliant vehicle location tracking and panic button connected to the aggregator control room and State Integrated Command and Control Centre; in-app trip tracking and route-deviation escalation also apply.
- A maximum vehicle age of 12 years, subject to stricter local fuel/permit conditions.
- Driver checks: UIDAI-backed Aadhaar verification, correct licence class, at least two years' driving experience, no specified convictions in the prior three years, medical/eyesight fitness, psychological evaluation by a registered psychiatrist, and police antecedent verification at least seven days before onboarding.
- Minimum 40-hour induction training, including at least six hours of first-responder training, defensive driving, route familiarisation, app use and gender/disability sensitisation; drivers below the fifth-percentile rating threshold must complete quarterly refresher training or cease providing service.
- Passenger insurance of at least ₹5 lakh; driver health insurance of at least ₹5 lakh and accidental/term cover of at least ₹10 lakh.

Noida is in the NCR. The UP 2026 rules' interaction with CAQM Direction 94 needs specific legal confirmation before selecting a fleet. The original CAQM Direction 94 restricted induction of conventional petrol/diesel two-wheelers from 1 January 2026, but the official CAQM amendment dated 23 December 2025 permits BS-VI-standard two-wheelers to be inducted into existing aggregator/DSP/e-commerce fleets through **31 December 2026**. This is a time-limited exception, not a blanket permission for private motorcycles or a guarantee that the same category can be inducted from 1 January 2027. Noida and Greater Noida are explicitly identified as high-vehicle-density NCR cities. A privately registered motorcycle must not be treated as eligible for paid passenger rides merely because the app can onboard a driver.

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

The current code's admin driver approval is an internal workflow only. It is not identity, police, medical, licence, vehicle, insurance or training verification. The support-report screen is not a staffed 24x7 call centre. A map marker is not an AIS-140 tracking/control-room integration.

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
- Processor/vendor agreements and a data-flow inventory covering hosting, maps, geocoding, analytics, messaging and payments.

Sources:
- [Digital Personal Data Protection Rules, 2025 — Gazette of India (MeitY PDF)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- [DPDP Act commencement notification — IndiaCode reproduction of Gazette text](https://egazette.gov.in/WriteReadData/2025/267647.pdf)

## 7. Open-source routing and map infrastructure

- [Valhalla](https://github.com/valhalla/valhalla) is an MIT-licensed open-source routing engine supporting driving, walking, bicycle and multimodal costing, route matrices, isochrones and map matching. It is a credible self-hosted candidate for a future route-provider adapter; production would still need a maintained regional OSM extract, compute/memory sizing, tile refreshes, monitoring and operational ownership.
- The current app uses Leaflet with public OSM raster tiles. This is suitable only for modest interactive evaluation traffic under the OSMF tile policy; it is not a commercial map-tile SLA.
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

**Decision:** keep RideForge labelled as a demonstration/portfolio product. Do not enable real paid trips, onboard real drivers or collect real passenger location data until every applicable gate has written evidence and an accountable owner.
