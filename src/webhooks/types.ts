/**
 * Shared types for webhook handlers.
 */

/**
 * Result from parsing a webhook payload.
 * Returned by webhook handlers for the middleware to submit to triage.
 */
export interface WebhookResult {
	/** Source identifier (e.g., "github-webhook") */
	source: string;
	/** Deduplication key for idempotency */
	sourceId: string;
	/** Human-readable summary for triage review */
	summary: string;
	/** Original raw payload */
	rawPayload: unknown;
}
