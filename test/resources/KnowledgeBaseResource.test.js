/**
 * Tests for KnowledgeBaseResource — REST endpoint for KB management.
 *
 * GET is public. POST, PUT, DELETE require team role.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { KnowledgeBaseResource } from '../../dist/resources/KnowledgeBaseResource.js';

describe('KnowledgeBaseResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET (list)', () => {
		it('returns all KBs without auth', async () => {
			await tables.KnowledgeBase.put({ id: 'kb-1', name: 'First KB' });
			await tables.KnowledgeBase.put({ id: 'kb-2', name: 'Second KB' });

			const resource = new KnowledgeBaseResource();
			const result = await resource.get();

			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 2);
		});

		it('returns empty array when no KBs exist', async () => {
			const resource = new KnowledgeBaseResource();
			const result = await resource.get();

			assert.deepStrictEqual(result, []);
		});
	});

	describe('GET (by ID)', () => {
		it('returns a single KB', async () => {
			await tables.KnowledgeBase.put({
				id: 'kb-x',
				name: 'KB X',
				description: 'Test KB',
			});

			const resource = new KnowledgeBaseResource();
			resource._setId('kb-x');
			const result = await resource.get();

			assert.strictEqual(result.id, 'kb-x');
			assert.strictEqual(result.name, 'KB X');
			assert.strictEqual(result.description, 'Test KB');
		});

		it('returns 404 for non-existent KB', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setId('missing');
			const result = await resource.get();

			assert.strictEqual(result.status, 404);
		});
	});

	describe('POST', () => {
		it('requires authentication', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: null });

			const result = await resource.post({}, { id: 'new', name: 'New' });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });

			const result = await resource.post({}, { id: 'new', name: 'New' });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if id or name is missing', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({}, { name: 'No ID' });

			assert.strictEqual(result.status, 400);
		});

		it('creates a KB and sets createdBy', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({
				user: { id: 'admin', username: 'admin', role: 'team' },
			});

			const result = await resource.post({}, { id: 'created-kb', name: 'Created' });

			assert.strictEqual(result.id, 'created-kb');
			assert.strictEqual(result.name, 'Created');
			assert.strictEqual(result.createdBy, 'admin');
		});

		it('returns 409 for duplicate KB', async () => {
			await tables.KnowledgeBase.put({ id: 'existing', name: 'Existing' });

			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.post({}, { id: 'existing', name: 'Duplicate' });

			assert.strictEqual(result.status, 409);
		});
	});

	describe('PUT', () => {
		it('requires authentication', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: null });
			resource._setId('kb-1');

			const result = await resource.put({}, { name: 'Updated' });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'u1', role: 'ai_agent' } });
			resource._setId('kb-1');

			const result = await resource.put({}, { name: 'Updated' });

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.put({}, { name: 'Updated' });

			assert.strictEqual(result.status, 400);
		});

		it('updates an existing KB', async () => {
			await tables.KnowledgeBase.put({ id: 'upd-kb', name: 'Old' });

			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('upd-kb');

			const result = await resource.put({}, { name: 'New Name' });

			assert.strictEqual(result.name, 'New Name');
		});

		it('returns 404 for non-existent KB', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing');

			const result = await resource.put({}, { name: 'Nope' });

			assert.strictEqual(result.status, 404);
		});
	});

	describe('DELETE', () => {
		it('requires authentication', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: null });
			resource._setId('kb-1');

			const result = await resource.delete();

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });
			resource._setId('kb-1');

			const result = await resource.delete();

			assert.strictEqual(result.status, 403);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.delete();

			assert.strictEqual(result.status, 400);
		});

		it('deletes an existing KB', async () => {
			await tables.KnowledgeBase.put({ id: 'del-kb', name: 'To Delete' });

			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('del-kb');

			const result = await resource.delete();

			assert.strictEqual(result, true);
			const stored = await tables.KnowledgeBase.get('del-kb');
			assert.strictEqual(stored, null);
		});

		it('returns 404 for non-existent KB', async () => {
			const resource = new KnowledgeBaseResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing');

			const result = await resource.delete();

			assert.strictEqual(result.status, 404);
		});
	});
});
