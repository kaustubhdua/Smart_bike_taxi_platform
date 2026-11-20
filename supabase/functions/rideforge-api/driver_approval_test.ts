import { assertEquals } from "jsr:@std/assert@1";
import { missingVerifiedDriverDocuments } from "./driver_approval.ts";

Deno.test("driver approval requires all three verified document types", () => {
  assertEquals(missingVerifiedDriverDocuments([
    { document_type: "driving_license", review_status: "verified" },
    { document_type: "vehicle_rc", review_status: "verified" },
    { document_type: "insurance", review_status: "verified" },
  ]), []);
});

Deno.test("pending and rejected documents do not satisfy approval", () => {
  assertEquals(missingVerifiedDriverDocuments([
    { document_type: "driving_license", review_status: "verified" },
    { document_type: "vehicle_rc", review_status: "pending" },
    { document_type: "insurance", review_status: "rejected" },
  ]), ["vehicle_rc", "insurance"]);
});

Deno.test("duplicate uploads do not hide a missing verified document", () => {
  assertEquals(missingVerifiedDriverDocuments([
    { document_type: "driving_license", review_status: "pending" },
    { document_type: "driving_license", review_status: "rejected" },
    { document_type: "vehicle_rc", review_status: "verified" },
  ]), ["driving_license", "insurance"]);
});
