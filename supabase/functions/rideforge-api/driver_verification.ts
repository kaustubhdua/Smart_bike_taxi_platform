export const REQUIRED_DRIVER_DOCUMENT_TYPES = ["driving_license", "vehicle_rc", "insurance"] as const;

export type DriverVerificationDocument = {
  document_type: string;
  review_status: string;
};

/** Returns required document types that do not have a verified upload. */
export function missingRequiredDriverDocuments(documents: DriverVerificationDocument[]): string[] {
  const verified = new Set(
    documents
      .filter(document => document.review_status === "verified")
      .map(document => document.document_type),
  );
  return REQUIRED_DRIVER_DOCUMENT_TYPES.filter(type => !verified.has(type));
}
