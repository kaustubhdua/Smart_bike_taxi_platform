import { assertEquals } from "jsr:@std/assert@1";
import { missingRequiredDriverDocuments } from "./driver_verification.ts";

Deno.test("driver approval is blocked until all three required documents are verified", () => {
  assertEquals(
    missingRequiredDriverDocuments([]),
    ["driving_license", "vehicle_rc", "insurance"],
  );
  assertEquals(
    missingRequiredDriverDocuments([
      { document_type: "driving_license", review_status: "verified" },
      { document_type: "vehicle_rc", review_status: "pending" },
      { document_type: "insurance", review_status: "verified" },
    ]),
    ["vehicle_rc"],
  );
});

Deno.test("pending and rejected uploads never satisfy verification requirements", () => {
  assertEquals(
    missingRequiredDriverDocuments([
      { document_type: "driving_license", review_status: "rejected" },
      { document_type: "vehicle_rc", review_status: "pending" },
      { document_type: "insurance", review_status: "verified" },
      { document_type: "other_document", review_status: "verified" },
    ]),
    ["driving_license", "vehicle_rc"],
  );
});

Deno.test("one verified upload for each required type satisfies the gate", () => {
  assertEquals(
    missingRequiredDriverDocuments([
      { document_type: "driving_license", review_status: "verified" },
      { document_type: "vehicle_rc", review_status: "verified" },
      { document_type: "insurance", review_status: "verified" },
    ]),
    [],
  );
});
