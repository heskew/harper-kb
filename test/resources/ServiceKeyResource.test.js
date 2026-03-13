/**
 * Tests for ServiceKeyResource — REST endpoint for API key management.
 *
 * All operations require team role. POST returns the plaintext key once.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { ServiceKeyResource } from '../../dist/resources/ServiceKeyResource.js';

const TEST_KB = 'test-kb';

describe('ServiceKeyResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET (list)', () => {
		it('requires authentication', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: null });

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 403);
		});

		it('returns keys without keyHash', async () => {
			await tables.ServiceKey.put({
				id: 'key-1',
				kbId: TEST_KB,
				name: 'My API Key',
				keyHash: 'salt:hash-should-be-stripped',
				role: 'service_account',
			});

			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'My API Key');
			assert.strictEqual(result[0].keyHash, undefined, 'keyHash should be stripped');
		});
	});

	describe('GET (by ID)', () => {
		it('returns a single key without keyHash', async () => {
			await tables.ServiceKey.put({
				id: 'key-2',
				kbId: TEST_KB,
				name: 'Specific Key',
				keyHash: 'salt:hash-value',
				role: 'ai_agent',
			});

			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('key-2');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.id, 'key-2');
			assert.strictEqual(result.name, 'Specific Key');
			assert.strictEqual(result.keyHash, undefined, 'keyHash should be stripped');
		});

		it('returns 404 for non-existent key', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing-key');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
		});
	});

	describe('POST', () => {
		it('requires authentication', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: null });

			const result = await resource.post({ kbId: TEST_KB }, { name: 'Test', role: 'service_account' });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'u1', role: 'ai_agent' } });

			const result = await resource.post({ kbId: TEST_KB }, { name: 'Test', role: 'service_account' });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if name is missing', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { role: 'service_account' });

			assert.strictEqual(result.status, 400);
		});

		it('returns 400 if role is invalid', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { name: 'Test', role: 'invalid_role' });

			assert.strictEqual(result.status, 400);
		});

		it('creates a key and returns the plaintext key once', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({
				user: { id: 'admin', username: 'admin', role: 'team' },
			});

			const result = await resource.post({ kbId: TEST_KB }, { name: 'New Key', role: 'service_account' });

			assert.ok(result.id, 'Should have an id');
			assert.strictEqual(result.name, 'New Key');
			assert.strictEqual(result.role, 'service_account');
			assert.ok(result.key, 'Should return the plaintext key');
			assert.ok(result.key.length > 20, 'Key should be sufficiently long');
			assert.strictEqual(result.keyHash, undefined, 'keyHash should not be exposed');
			assert.strictEqual(result.createdBy, 'admin');

			// Verify the keyHash is stored in the table
			const stored = await tables.ServiceKey.get(result.id);
			assert.ok(stored.keyHash, 'keyHash should be stored in the table');
			assert.ok(stored.keyHash.includes(':'), 'keyHash should contain salt:hash');
		});

		it('accepts ai_agent role', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { name: 'Agent Key', role: 'ai_agent' });

			assert.strictEqual(result.role, 'ai_agent');
			assert.ok(result.key);
		});
	});

	describe('DELETE', () => {
		it('requires authentication', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: null });
			resource._setId('key-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });
			resource._setId('key-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 400);
		});

		it('deletes an existing key', async () => {
			await tables.ServiceKey.put({
				id: 'del-key-1',
				kbId: TEST_KB,
				name: 'To Delete',
				keyHash: 'salt:hash',
				role: 'service_account',
			});

			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('del-key-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result, true);

			const stored = await tables.ServiceKey.get('del-key-1');
			assert.strictEqual(stored, null, 'Key should be removed from storage');
		});

		it('returns 404 for non-existent key', async () => {
			const resource = new ServiceKeyResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
		});
	});
});
