export const REQUIRED_DRIVER_DOCUMENT_TYPES = ["driving_license", "vehicle_rc", "insurance"] as const;

export type DriverDocumentReview = {
  document_type: string;
  review_status: string;
  created_at?: string;
};

/** Return required document types that do not have a verified review record. */
export function missingVerifiedDriverDocuments(documents: readonly DriverDocumentReview[]): string[] {
  const latestReviewByType = new Map<string, string>();
  // Callers order by created_at DESC, so the first record is the current upload.
  for (const document of documents) {
    if (!latestReviewByType.has(document.document_type)) {
      latestReviewByType.set(document.document_type, document.review_status);
    }
  }
  return REQUIRED_DRIVER_DOCUMENT_TYPES.filter(type => latestReviewByType.get(type) !== "verified");
}
