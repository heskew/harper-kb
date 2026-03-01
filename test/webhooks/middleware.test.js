/**
 * Tests for webhooks/middleware — routing, secret validation, and pass-through.
 *
 * Each test creates a webhook endpoint to get a per-KB secret,
 * then uses that secret in both the URL and for HMAC signing.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { createWebhookMiddleware } from '../../dist/webhooks/middleware.js';
import { createWebhookEndpoint } from '../../dist/core/webhook-endpoints.js';

const TEST_KB = 'test-kb';

/**
 * Create a mock scope for testing.
 */
function createMockScope() {
	return {
		logger: globalThis.logger,
		resources: { set: () => {} },
		server: { http: () => {} },
		options: {
			get: () => undefined,
			getAll: () => ({}),
			on: () => {},
		},
		on: () => {},
	};
}

/**
 * Create a mock Harper request.
 */
function createRequest({ method = 'POST', pathname, headers = {}, body = '' }) {
	return {
		method,
		pathname,
		url: pathname,
		headers,
		body,
	};
}

/**
 * Sign a body with a secret for GitHub webhook testing.
 */
function signGitHub(body, secret) {
	return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * A mock next() function that records whether it was called.
 */
function createNext() {
	let called = false;
	const fn = async () => {
		called = true;
		return new Response('next-handler', { status: 200 });
	};
	fn.wasCalled = () => called;
	return fn;
}

// ==========================================================================
// Routing
// ==========================================================================

describe('webhook middleware — routing', () => {
	beforeEach(() => clearAllTables());

	it('passes non-webhook paths through to next()', async () => {
		const middleware = createWebhookMiddleware(createMockScope());
		const next = createNext();

		await middleware(createRequest({ pathname: '/api/data' }), next);
		assert.ok(next.wasCalled(), 'next() should have been called');
	});

	it('passes /mcp paths through to next()', async () => {
		const middleware = createWebhookMiddleware(createMockScope());
		const next = createNext();

		await middleware(createRequest({ pathname: '/mcp' }), next);
		assert.ok(next.wasCalled());
	});

	it('returns 400 for incomplete webhook path', async () => {
		const middleware = createWebhookMiddleware(createMockScope());
		const next = createNext();

		const response = await middleware(createRequest({ pathname: `/webhooks/${TEST_KB}/github` }), next);
		assert.strictEqual(response.status, 400);
		assert.ok(!next.wasCalled());
	});

	it('returns 404 for unknown provider with valid secret format', async () => {
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
		const { secret } = await createWebhookEndpoint(TEST_KB, 'github');

		const middleware = createWebhookMiddleware(createMockScope());
		const next = createNext();

		// Use a valid secret but wrong provider path
		const response = await middleware(createRequest({ pathname: `/webhooks/${TEST_KB}/slack/${secret}` }), next);
		assert.strictEqual(response.status, 404);
	});

	it('returns 405 for non-POST requests', async () => {
		const middleware = createWebhookMiddleware(createMockScope());
		const next = createNext();

		const response = await middleware(
			createRequest({
				method: 'GET',
				pathname: `/webhooks/${TEST_KB}/github/some-secret`,
			}),
			next
		);
		assert.strictEqual(response.status, 405);
	});
});

// ==========================================================================
// Secret validation
// ==========================================================================

describe('webhook middleware — secret validation', () => {
	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
	});

	it('returns 404 for invalid secret', async () => {
		const middleware = createWebhookMiddleware(createMockScope());

		const response = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/wrong-secret`,
			}),
			createNext()
		);
		assert.strictEqual(response.status, 404);
	});

	it('returns 404 when secret belongs to a different KB', async () => {
		await tables.KnowledgeBase.put({ id: 'other-kb', name: 'Other KB' });
		const { secret } = await createWebhookEndpoint('other-kb', 'github');

		const middleware = createWebhookMiddleware(createMockScope());

		const response = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/${secret}`,
			}),
			createNext()
		);
		assert.strictEqual(response.status, 404);
	});
});

// ==========================================================================
// GitHub webhook endpoint
// ==========================================================================

describe('webhook middleware — GitHub', () => {
	let secret;

	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
		const result = await createWebhookEndpoint(TEST_KB, 'github');
		secret = result.secret;
	});

	it('returns 401 for invalid HMAC signature', async () => {
		const middleware = createWebhookMiddleware(createMockScope());

		const body = JSON.stringify({ action: 'opened' });
		const response = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/${secret}`,
				headers: {
					'x-hub-signature-256': 'sha256=invalid',
					'x-github-event': 'issues',
				},
				body,
			}),
			createNext()
		);
		assert.strictEqual(response.status, 401);
	});

	it('accepts valid GitHub issue webhook and creates triage item', async () => {
		const middleware = createWebhookMiddleware(createMockScope());

		const payload = {
			action: 'opened',
			repository: { full_name: 'owner/repo' },
			issue: {
				number: 1,
				title: 'New issue',
				body: 'Issue body here.',
				user: { login: 'testuser' },
				labels: [],
			},
		};
		const body = JSON.stringify(payload);
		const sig = signGitHub(body, secret);

		const response = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/${secret}`,
				headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
				body,
			}),
			createNext()
		);

		assert.strictEqual(response.status, 200);
		const json = await response.json();
		assert.strictEqual(json.status, 'accepted');
		assert.ok(json.triageId);

		// Verify triage item was created
		const item = await databases.kb.TriageItem.get(json.triageId);
		assert.ok(item);
		assert.strictEqual(item.kbId, TEST_KB);
		assert.strictEqual(item.source, 'github-webhook');
		assert.strictEqual(item.sourceId, 'github:issues:opened:owner/repo#1');
	});

	it('returns ignored for unsupported GitHub events', async () => {
		const middleware = createWebhookMiddleware(createMockScope());

		const body = JSON.stringify({ ref: 'refs/heads/main' });
		const sig = signGitHub(body, secret);

		const response = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/${secret}`,
				headers: { 'x-hub-signature-256': sig, 'x-github-event': 'push' },
				body,
			}),
			createNext()
		);

		assert.strictEqual(response.status, 200);
		const json = await response.json();
		assert.strictEqual(json.status, 'ignored');
	});

	it('rejects duplicate delivery IDs via WebhookDelivery table', async () => {
		const middleware = createWebhookMiddleware(createMockScope());

		const payload = {
			action: 'opened',
			repository: { full_name: 'owner/repo' },
			issue: {
				number: 77,
				title: 'Delivery dedup test',
				body: 'Body.',
				user: { login: 'u' },
				labels: [],
			},
		};
		const body = JSON.stringify(payload);
		const sig = signGitHub(body, secret);
		const deliveryId = 'delivery-abc-123';

		// First request with delivery ID
		const r1 = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/${secret}`,
				headers: {
					'x-hub-signature-256': sig,
					'x-github-event': 'issues',
					'x-github-delivery': deliveryId,
				},
				body,
			}),
			createNext()
		);
		const j1 = await r1.json();
		assert.strictEqual(j1.status, 'accepted');

		// Verify delivery was recorded in the table
		const recorded = await databases.kb.WebhookDelivery.get(deliveryId);
		assert.ok(recorded);
		assert.strictEqual(recorded.kbId, TEST_KB);
		assert.strictEqual(recorded.provider, 'github');

		// Second request with same delivery ID — should be rejected
		const r2 = await middleware(
			createRequest({
				pathname: `/webhooks/${TEST_KB}/github/${secret}`,
				headers: {
					'x-hub-signature-256': sig,
					'x-github-event': 'issues',
					'x-github-delivery': deliveryId,
				},
				body,
			}),
			createNext()
		);
		const j2 = await r2.json();
		assert.strictEqual(j2.status, 'duplicate');
		assert.strictEqual(j2.deliveryId, deliveryId);
	});

	it('deduplicates by sourceId', async () => {
		const middleware = createWebhookMiddleware(createMockScope());

		const payload = {
			action: 'opened',
			repository: { full_name: 'owner/repo' },
			issue: {
				number: 99,
				title: 'Dupe test',
				body: 'Body.',
				user: { login: 'u' },
				labels: [],
			},
		};
		const body = JSON.stringify(payload);
		const sig = signGitHub(body, secret);
		const request = createRequest({
			pathname: `/webhooks/${TEST_KB}/github/${secret}`,
			headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' },
			body,
		});

		// First request
		const r1 = await middleware(request, createNext());
		const j1 = await r1.json();
		assert.strictEqual(j1.status, 'accepted');

		// Second request (same payload)
		const r2 = await middleware(request, createNext());
		const j2 = await r2.json();
		assert.strictEqual(j2.status, 'duplicate');
		assert.strictEqual(j2.triageId, j1.triageId);
	});
});
