export const REQUIRED_DRIVER_DOCUMENT_TYPES = ["driving_license", "vehicle_rc", "insurance"] as const;

export type DriverDocumentReview = {
  document_type: string;
  review_status: string;
};

/** Return required document types that do not have a verified review record. */
export function missingVerifiedDriverDocuments(documents: readonly DriverDocumentReview[]): string[] {
  const verified = new Set(
    documents.filter(document => document.review_status === "verified").map(document => document.document_type),
  );
  return REQUIRED_DRIVER_DOCUMENT_TYPES.filter(type => !verified.has(type));
}
