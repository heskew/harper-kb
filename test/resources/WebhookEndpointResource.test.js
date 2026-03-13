/**
 * Tests for WebhookEndpointResource — REST endpoint for webhook management.
 *
 * All operations require team role. POST returns the secret and URL once.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { WebhookEndpointResource } from '../../dist/resources/WebhookEndpointResource.js';

const TEST_KB = 'test-kb';

describe('WebhookEndpointResource', () => {
	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
	});

	describe('GET (list)', () => {
		it('requires authentication', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: null });

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if kbId is missing', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.get();

			assert.strictEqual(result.status, 400);
		});

		it('returns endpoints for a KB', async () => {
			// Create an endpoint directly in the table
			await tables.WebhookEndpoint.put({
				id: 'ep-1',
				kbId: TEST_KB,
				provider: 'github',
				label: 'owner/repo',
			});

			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].provider, 'github');
			assert.strictEqual(result[0].label, 'owner/repo');
		});
	});

	describe('POST', () => {
		it('requires authentication', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: null });

			const result = await resource.post({ kbId: TEST_KB }, { provider: 'github' });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'u1', role: 'ai_agent' } });

			const result = await resource.post({ kbId: TEST_KB }, { provider: 'github' });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if provider is missing', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, {});

			assert.strictEqual(result.status, 400);
		});

		it('returns 400 for invalid provider', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { provider: 'slack' });

			assert.strictEqual(result.status, 400);
		});

		it('creates endpoint and returns secret and URL once', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { provider: 'github', label: 'owner/repo' });

			assert.ok(result.id, 'Should have an id');
			assert.strictEqual(result.kbId, TEST_KB);
			assert.strictEqual(result.provider, 'github');
			assert.strictEqual(result.label, 'owner/repo');
			assert.ok(result.secret, 'Should return the plaintext secret');
			assert.ok(result.webhookUrl.includes(`/webhooks/${TEST_KB}/github/`), 'Should return the webhook URL');
			assert.ok(result.webhookUrl.includes(result.secret), 'URL should contain the secret');
		});

		it('returns 404 for non-existent KB', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: 'nonexistent' }, { provider: 'github' });

			assert.strictEqual(result.status, 404);
		});
	});

	describe('DELETE', () => {
		it('requires authentication', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: null });
			resource._setId('ep-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });
			resource._setId('ep-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 400);
		});

		it('deletes an existing endpoint', async () => {
			await tables.WebhookEndpoint.put({
				id: 'del-ep-1',
				kbId: TEST_KB,
				provider: 'github',
			});

			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('del-ep-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result, true);

			const stored = await tables.WebhookEndpoint.get('del-ep-1');
			assert.strictEqual(stored, null);
		});

		it('returns 404 for non-existent endpoint', async () => {
			const resource = new WebhookEndpointResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
		});
	});
});
