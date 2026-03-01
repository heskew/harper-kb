/**
 * Tests for TriageResource — REST endpoint for the triage intake queue.
 *
 * GET requires team role; POST requires service_account or ai_agent; PUT requires team role.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { TriageResource } from '../../dist/resources/TriageResource.js';

const TEST_KB = 'test-kb';

describe('TriageResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET', () => {
		it('requires authentication', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: null });

			const result = await resource.get();

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });

			const result = await resource.get();

			assert.strictEqual(result.status, 403);
		});

		it('returns pending triage items for team users', async () => {
			await tables.TriageItem.put({
				id: 'tri-1',
				kbId: TEST_KB,
				source: 'webhook',
				summary: 'Test item',
				status: 'pending',
			});
			await tables.TriageItem.put({
				id: 'tri-2',
				kbId: TEST_KB,
				source: 'manual',
				summary: 'Dismissed item',
				status: 'dismissed',
			});

			const resource = new TriageResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 1, 'Should only return pending items');
			assert.strictEqual(result[0].id, 'tri-1');
		});
	});

	describe('POST', () => {
		it('requires authentication', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: null });

			const result = await resource.post({}, { source: 'test', summary: 'Test' });

			assert.strictEqual(result.status, 401);
		});

		it('requires service_account or ai_agent role', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'u1', role: 'team' } });

			const result = await resource.post({}, { source: 'test', summary: 'Test' });

			assert.strictEqual(result.status, 403);
		});

		it('creates a triage item for service_account', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'svc-1', role: 'service_account' } });

			const result = await resource.post(
				{ kbId: TEST_KB },
				{ source: 'github-webhook', summary: 'New issue detected' }
			);

			assert.ok(result.id);
			assert.strictEqual(result.source, 'github-webhook');
			assert.strictEqual(result.status, 'pending');
		});

		it('creates a triage item for ai_agent', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'bot-1', role: 'ai_agent' } });

			const result = await resource.post({ kbId: TEST_KB }, { source: 'claude-code', summary: 'Discovered knowledge' });

			assert.ok(result.id);
			assert.strictEqual(result.source, 'claude-code');
		});

		it('returns 400 if source is missing', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'svc-1', role: 'service_account' } });

			const result = await resource.post({ kbId: TEST_KB }, { summary: 'No source' });

			assert.strictEqual(result.status, 400);
		});

		it('returns 400 if summary is missing', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'svc-1', role: 'service_account' } });

			const result = await resource.post({ kbId: TEST_KB }, { source: 'test' });

			assert.strictEqual(result.status, 400);
		});
	});

	describe('PUT', () => {
		it('requires authentication', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: null });
			resource._setId('some-id');

			const result = await resource.put({}, { action: 'dismissed' });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });
			resource._setId('some-id');

			const result = await resource.put({}, { action: 'dismissed' });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.put({ kbId: TEST_KB }, { action: 'dismissed' });

			assert.strictEqual(result.status, 400);
		});

		it('returns 400 if action is missing', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('tri-1');

			const result = await resource.put({ kbId: TEST_KB }, {});

			assert.strictEqual(result.status, 400);
		});

		it('processes a triage item (dismiss)', async () => {
			await tables.TriageItem.put({
				id: 'put-1',
				kbId: TEST_KB,
				source: 'webhook',
				summary: 'To process',
				status: 'pending',
			});

			const resource = new TriageResource();
			resource._setContext({
				user: { id: 'admin', username: 'admin', role: 'team' },
			});
			resource._setId('put-1');

			const result = await resource.put({ kbId: TEST_KB }, { action: 'dismissed' });

			assert.strictEqual(result.status, 'dismissed');
			assert.strictEqual(result.processedBy, 'admin');
		});

		it('returns 404 for non-existent triage item', async () => {
			const resource = new TriageResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing');

			const result = await resource.put({ kbId: TEST_KB }, { action: 'dismissed' });

			assert.strictEqual(result.status, 404);
		});
	});
});
