/**
 * Tests for webhook endpoint management — create, validate, list, delete.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import {
	createWebhookEndpoint,
	validateWebhookSecret,
	listWebhookEndpoints,
	deleteWebhookEndpoint,
	hashSecret,
} from '../../dist/core/webhook-endpoints.js';

const TEST_KB = 'test-kb';

describe('createWebhookEndpoint', () => {
	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
	});

	it('generates a secret and stores the endpoint', async () => {
		const { endpoint, secret } = await createWebhookEndpoint(TEST_KB, 'github');

		assert.ok(secret, 'Should return a plaintext secret');
		assert.ok(secret.length > 20, 'Secret should be long enough');
		assert.strictEqual(endpoint.kbId, TEST_KB);
		assert.strictEqual(endpoint.provider, 'github');
		assert.strictEqual(endpoint.id, hashSecret(secret));
	});

	it('stores the endpoint in the table', async () => {
		const { endpoint } = await createWebhookEndpoint(TEST_KB, 'github');

		const stored = await tables.WebhookEndpoint.get(endpoint.id);
		assert.ok(stored);
		assert.strictEqual(stored.kbId, TEST_KB);
		assert.strictEqual(stored.provider, 'github');
	});

	it('stores a label when provided', async () => {
		const { endpoint } = await createWebhookEndpoint(TEST_KB, 'github', 'owner/repo');

		const stored = await tables.WebhookEndpoint.get(endpoint.id);
		assert.strictEqual(stored.label, 'owner/repo');
	});

	it('throws when KB does not exist', async () => {
		await assert.rejects(() => createWebhookEndpoint('nonexistent', 'github'), /not found/);
	});

	it('generates unique secrets for each call', async () => {
		const r1 = await createWebhookEndpoint(TEST_KB, 'github');
		const r2 = await createWebhookEndpoint(TEST_KB, 'github');

		assert.notStrictEqual(r1.secret, r2.secret);
		assert.notStrictEqual(r1.endpoint.id, r2.endpoint.id);
	});
});

describe('validateWebhookSecret', () => {
	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
	});

	it('returns the endpoint for a valid secret', async () => {
		const { secret } = await createWebhookEndpoint(TEST_KB, 'github');

		const result = await validateWebhookSecret(secret, TEST_KB, 'github');

		assert.ok(result);
		assert.strictEqual(result.kbId, TEST_KB);
		assert.strictEqual(result.provider, 'github');
	});

	it('returns null for an invalid secret', async () => {
		await createWebhookEndpoint(TEST_KB, 'github');

		const result = await validateWebhookSecret('wrong-secret', TEST_KB, 'github');

		assert.strictEqual(result, null);
	});

	it('returns null when kbId does not match', async () => {
		const { secret } = await createWebhookEndpoint(TEST_KB, 'github');

		const result = await validateWebhookSecret(secret, 'other-kb', 'github');

		assert.strictEqual(result, null);
	});

	it('returns null when provider does not match', async () => {
		const { secret } = await createWebhookEndpoint(TEST_KB, 'github');

		const result = await validateWebhookSecret(secret, TEST_KB, 'other');

		assert.strictEqual(result, null);
	});
});

describe('listWebhookEndpoints', () => {
	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
	});

	it('returns all endpoints for a KB', async () => {
		await createWebhookEndpoint(TEST_KB, 'github', 'repo-1');
		await createWebhookEndpoint(TEST_KB, 'github', 'repo-2');

		const results = await listWebhookEndpoints(TEST_KB);

		assert.strictEqual(results.length, 2);
	});

	it('returns empty array when no endpoints exist', async () => {
		const results = await listWebhookEndpoints(TEST_KB);

		assert.deepStrictEqual(results, []);
	});

	it('only returns endpoints for the specified KB', async () => {
		await tables.KnowledgeBase.put({ id: 'other-kb', name: 'Other KB' });
		await createWebhookEndpoint(TEST_KB, 'github');
		await createWebhookEndpoint('other-kb', 'github');

		const results = await listWebhookEndpoints(TEST_KB);

		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].kbId, TEST_KB);
	});
});

describe('deleteWebhookEndpoint', () => {
	beforeEach(async () => {
		clearAllTables();
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });
	});

	it('deletes an existing endpoint', async () => {
		const { endpoint } = await createWebhookEndpoint(TEST_KB, 'github');

		await deleteWebhookEndpoint(endpoint.id, TEST_KB);

		const stored = await tables.WebhookEndpoint.get(endpoint.id);
		assert.strictEqual(stored, null);
	});

	it('throws for non-existent endpoint', async () => {
		await assert.rejects(() => deleteWebhookEndpoint('nonexistent', TEST_KB), /not found/);
	});

	it('throws when kbId does not match', async () => {
		const { endpoint } = await createWebhookEndpoint(TEST_KB, 'github');

		await assert.rejects(() => deleteWebhookEndpoint(endpoint.id, 'other-kb'), /not found/);
	});
});

describe('hashSecret', () => {
	it('produces a consistent SHA-256 hex hash', () => {
		const secret = 'test-secret-value';
		const expected = crypto.createHash('sha256').update(secret).digest('hex');

		assert.strictEqual(hashSecret(secret), expected);
	});

	it('produces different hashes for different secrets', () => {
		assert.notStrictEqual(hashSecret('secret-1'), hashSecret('secret-2'));
	});
});
