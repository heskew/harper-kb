/**
 * Webhook Endpoint Management
 *
 * CRUD operations for per-KB webhook endpoints. Each endpoint has a
 * randomly generated secret that is embedded in the webhook URL and
 * also serves as the HMAC signing key for GitHub payload verification.
 *
 * The secret is never stored in plaintext — only its SHA-256 hash is
 * persisted as the record's primary key for O(1) lookup.
 */

import crypto from 'node:crypto';
import type { WebhookEndpoint } from '../types.ts';

/**
 * Hash a webhook secret to produce the record ID.
 * SHA-256 is sufficient — these are high-entropy random tokens, not passwords.
 */
export function hashSecret(secret: string): string {
	return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * Create a new webhook endpoint for a KB.
 *
 * Generates a random secret, stores the SHA-256 hash as the record ID,
 * and returns both the record and the plaintext secret (shown once).
 *
 * @throws If the KB does not exist
 */
export async function createWebhookEndpoint(
	kbId: string,
	provider: string,
	label?: string,
	createdBy?: string
): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
	// Verify KB exists
	const kb = await databases.kb.KnowledgeBase.get(kbId);
	if (!kb) {
		throw new Error(`Knowledge base "${kbId}" not found`);
	}

	const secret = crypto.randomBytes(32).toString('base64url');
	const id = hashSecret(secret);

	const endpoint: WebhookEndpoint = {
		id,
		kbId,
		provider,
		label: label || undefined,
		createdBy: createdBy || undefined,
	};

	await databases.kb.WebhookEndpoint.put(endpoint as unknown as Record<string, unknown>);

	return { endpoint, secret };
}

/**
 * Validate a webhook secret against a KB and provider.
 *
 * Hashes the secret, looks up the record, and verifies the kbId and
 * provider match. Returns the record if valid, null otherwise.
 */
export async function validateWebhookSecret(
	secret: string,
	kbId: string,
	provider: string
): Promise<WebhookEndpoint | null> {
	const id = hashSecret(secret);
	const record = await databases.kb.WebhookEndpoint.get(id);
	if (!record) return null;

	const endpoint = record as unknown as WebhookEndpoint;
	if (endpoint.kbId !== kbId || endpoint.provider !== provider) return null;

	return endpoint;
}

/**
 * List all webhook endpoints for a KB.
 */
export async function listWebhookEndpoints(kbId: string): Promise<WebhookEndpoint[]> {
	const results: WebhookEndpoint[] = [];
	for await (const item of databases.kb.WebhookEndpoint.search({
		conditions: [{ attribute: 'kbId', comparator: 'equals', value: kbId }],
	})) {
		results.push(item as unknown as WebhookEndpoint);
	}
	return results;
}

/**
 * Delete a webhook endpoint.
 *
 * @throws If the endpoint does not exist or belongs to a different KB
 */
export async function deleteWebhookEndpoint(id: string, kbId: string): Promise<void> {
	const record = await databases.kb.WebhookEndpoint.get(id);
	if (!record || (record as unknown as WebhookEndpoint).kbId !== kbId) {
		throw new Error('Webhook endpoint not found');
	}

	await databases.kb.WebhookEndpoint.delete(id);
}
