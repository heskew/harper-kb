/**
 * Webhook Middleware
 *
 * HTTP middleware for Harper's scope.server.http() that routes
 * /webhooks/<kbId>/<provider>/<secret> requests to the appropriate
 * webhook handler after validating the per-KB secret.
 */

import { readBody } from '../http-utils.ts';
import { submitTriage, findBySourceId } from '../core/triage.ts';
import { validateWebhookSecret } from '../core/webhook-endpoints.ts';
import { validateSignature as validateGitHubSignature, parsePayload as parseGitHubPayload } from './github.ts';
import type { Scope, HarperRequest } from '../types.ts';
import type { WebhookResult } from './types.ts';

/**
 * Check if a delivery ID has already been processed, using a TTL table
 * so dedup is consistent across all workers.
 */
async function isDuplicateDelivery(deliveryId: string, kbId: string, provider: string): Promise<boolean> {
	const existing = await databases.kb.WebhookDelivery.get(deliveryId);
	if (existing) return true;
	await databases.kb.WebhookDelivery.put({ id: deliveryId, kbId, provider });
	return false;
}

/**
 * Create a webhook middleware function for Harper's scope.server.http().
 *
 * URL format: /webhooks/<kbId>/<provider>/<secret>
 *
 * The secret is validated against the WebhookEndpoint table for the
 * given KB and provider. The same secret is used to verify the GitHub
 * HMAC payload signature.
 */
export function createWebhookMiddleware(
	scope: Scope
): (request: HarperRequest, next: (req: HarperRequest) => Promise<unknown>) => Promise<unknown> {
	const scopeLogger = scope.logger;

	return async (request: HarperRequest, next: (req: HarperRequest) => Promise<unknown>): Promise<unknown> => {
		const pathname = request.pathname || '';

		// Only handle /webhooks/* routes
		if (!pathname.startsWith('/webhooks/')) {
			return next(request);
		}

		// Only accept POST
		if (request.method !== 'POST') {
			return jsonResponse(405, { error: 'Method not allowed' });
		}

		// Extract kbId, provider, and secret from path:
		// /webhooks/<kbId>/<provider>/<secret>
		const parts = pathname.replace(/^\/webhooks\//, '').split('/');
		if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
			return jsonResponse(400, {
				error: 'Invalid webhook path. Use /webhooks/<kbId>/<provider>/<secret>',
			});
		}
		const kbId = parts[0];
		const provider = parts[1];
		const secret = parts[2];

		// Validate the secret against the WebhookEndpoint table
		const endpoint = await validateWebhookSecret(secret, kbId, provider);
		if (!endpoint) {
			return jsonResponse(404, { error: 'Unknown webhook endpoint' });
		}

		// Route to the appropriate handler
		if (provider === 'github') {
			return handleGitHub(request, secret, kbId, scopeLogger);
		}

		return jsonResponse(404, { error: 'Unknown webhook provider' });
	};
}

async function handleGitHub(
	request: HarperRequest,
	secret: string,
	kbId: string,
	scopeLogger: Scope['logger']
): Promise<Response> {
	// Read raw body
	const rawBody = await readBody(request);

	// Validate HMAC signature using the secret from the URL
	const signature = getHeader(request, 'x-hub-signature-256');
	if (!validateGitHubSignature(rawBody, signature, secret)) {
		return jsonResponse(401, { error: 'Invalid signature' });
	}

	// Replay protection — reject duplicate delivery IDs
	const deliveryId = getHeader(request, 'x-github-delivery');
	if (deliveryId && (await isDuplicateDelivery(deliveryId, kbId, 'github'))) {
		return jsonResponse(200, { status: 'duplicate', deliveryId });
	}

	// Parse payload
	let payload: Record<string, any>;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return jsonResponse(400, { error: 'Invalid JSON' });
	}

	const event = getHeader(request, 'x-github-event');
	const result = parseGitHubPayload(event, payload);

	if (!result) {
		// Event type we don't handle — acknowledge without creating triage item
		return jsonResponse(200, { status: 'ignored' });
	}

	return submitResult(kbId, result, scopeLogger);
}

/**
 * Submit a webhook result to the triage queue, checking for duplicates first.
 */
async function submitResult(kbId: string, result: WebhookResult, scopeLogger: Scope['logger']): Promise<Response> {
	// Idempotency check
	const existing = await findBySourceId(kbId, result.sourceId);
	if (existing) {
		return jsonResponse(200, { status: 'duplicate', triageId: existing.id });
	}

	const item = await submitTriage(kbId, result.source, result.summary, result.rawPayload, result.sourceId);
	scopeLogger?.info?.(`Webhook triage item created: ${item.id} (${result.source})`);

	return jsonResponse(200, { status: 'accepted', triageId: item.id });
}

/**
 * Get a header value from Harper's request, case-insensitive.
 */
function getHeader(request: HarperRequest, name: string): string {
	const headers = request.headers;
	if (!headers) return '';

	// Try direct access (case-sensitive)
	const direct = (headers as any)[name] ?? (headers as any)[name.toLowerCase()];
	if (direct !== undefined) {
		return Array.isArray(direct) ? direct[0] : String(direct);
	}

	// Try .get() method (Harper's Headers class)
	if (typeof (headers as any).get === 'function') {
		const val = (headers as any).get(name);
		if (val !== undefined && val !== null) return String(val);
	}

	// Fallback: iterate to find case-insensitive match
	const lowerName = name.toLowerCase();
	if (typeof headers === 'object') {
		for (const [key, value] of Object.entries(headers)) {
			if (key.toLowerCase() === lowerName && value !== undefined) {
				return Array.isArray(value) ? value[0] : String(value);
			}
		}
	}

	return '';
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
