# Driver provisioning and demo verification policy

RideForge is a portfolio MVP. Driver provisioning is restricted to an authenticated administrator; public passenger registration cannot create a driver or grant any privileged role. Newly provisioned drivers start offline and unapproved. Approval, suspension and reactivation are server-authorized actions recorded in the admin audit history. Suspension removes dispatch eligibility and forces the driver offline.

## Local portfolio/demo policy

- Use only synthetic demo identities, vehicle registrations and test locations.
- Do not upload or store real identity cards, driving licences, insurance certificates, phone numbers, or other sensitive documents in the demo.
- Only approve a driver account when the operator has explicitly designated it as a controlled demo/test account.
- A demo approval is a software access-control decision, **not** identity, licence, vehicle, insurance, criminal-record or legal eligibility verification.
- Driver availability requires browser location permission. Location is refreshed approximately once per minute while the driver workspace is open and online. Dispatch eligibility expires when the location becomes stale.
- Admin approval/suspension actions and audit records are part of the demonstration; they do not replace a real fleet onboarding process.

## Requirements before real-world operation

Before processing real driver documents or dispatching real passenger rides, define and obtain legal review for the operating jurisdiction and vehicle category. At minimum, establish a documented verification process for identity, driving licence and permitted vehicle class, vehicle registration, insurance, required permits, background checks where lawful, consent, expiry/re-verification, rejection/appeal, suspension, and secure document retention/deletion. Restrict access to verification records, record reviewer and decision timestamps, and keep evidence of checks without logging document contents or precise location unnecessarily.

Do not launch real rides until applicable state transport/aggregator requirements, insurance, privacy/data-protection obligations, customer support, incident response and safety escalation have been reviewed by qualified professionals. A portfolio demo approval must never be represented as government or third-party verification.
