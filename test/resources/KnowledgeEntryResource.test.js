/**
 * Tests for KnowledgeEntryResource — REST endpoint for knowledge entries.
 *
 * GET is public; POST, PUT, DELETE require authentication.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { KnowledgeEntryResource } from '../../dist/resources/KnowledgeEntryResource.js';

const TEST_KB = 'test-kb';

describe('KnowledgeEntryResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET', () => {
		it('returns an entry by ID', async () => {
			await tables.KnowledgeEntry.put({
				id: 'get-1',
				kbId: TEST_KB,
				title: 'Test Entry',
				content: 'Content body',
				tags: ['test'],
				confidence: 'verified',
				deprecated: false,
			});

			const resource = new KnowledgeEntryResource();
			resource._setId('get-1');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.title, 'Test Entry');
			assert.strictEqual(result.content, 'Content body');
		});

		it('returns 404 for a non-existent ID', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setId('nonexistent');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
			assert.strictEqual(result.data.error, 'Entry not found');
		});

		it('searches entries when no ID is set but query is provided', async () => {
			await tables.KnowledgeEntry.put({
				id: 'search-1',
				kbId: TEST_KB,
				title: 'Plugin configuration guide',
				content: 'How to configure plugins',
				tags: [],
				confidence: 'verified',
				deprecated: false,
			});

			const resource = new KnowledgeEntryResource();
			// No id set — triggers search mode

			const result = await resource.get({ kbId: TEST_KB, query: 'Plugin', mode: 'keyword' });

			assert.ok(Array.isArray(result));
		});

		it('returns list of entries when no ID and no query (browse mode)', async () => {
			const resource = new KnowledgeEntryResource();

			const result = await resource.get({ kbId: TEST_KB });

			assert.ok(Array.isArray(result), 'Should return an array of entries');
		});
	});

	describe('POST', () => {
		it('requires authentication', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: null });

			await assert.rejects(
				() => resource.post({ kbId: TEST_KB }, { title: 'Test', content: 'Body', tags: [] }),
				(err) => err.statusCode === 401
			);
		});

		it('creates an entry when authenticated', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({
				user: { id: 'user-1', username: 'tester', role: 'team' },
			});

			const result = await resource.post(
				{ kbId: TEST_KB },
				{ title: 'New Entry', content: 'Body content', tags: ['test'], kbId: TEST_KB }
			);

			assert.ok(result.id, 'Should return the created entry with an id');
			assert.strictEqual(result.title, 'New Entry');
			assert.strictEqual(result.addedBy, 'tester');
		});

		it('returns 400 if title is missing', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'user-1', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { content: 'Body' });

			assert.strictEqual(result.status, 400);
		});

		it('returns 400 if content is missing', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'user-1', role: 'team' } });

			const result = await resource.post({ kbId: TEST_KB }, { title: 'Title' });

			assert.strictEqual(result.status, 400);
		});

		it('forces ai-generated confidence for ai-agent role', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'bot-1', role: 'ai-agent' } });

			const result = await resource.post(
				{ kbId: TEST_KB },
				{
					title: 'AI Entry',
					content: 'Generated',
					tags: [],
					confidence: 'verified', // Should be overridden
					kbId: TEST_KB,
				}
			);

			assert.strictEqual(result.confidence, 'ai-generated');
		});
	});

	describe('PUT', () => {
		it('requires authentication', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: null });
			resource._setId('some-id');

			const result = await resource.put({ kbId: TEST_KB }, { title: 'Updated' });

			assert.strictEqual(result.status, 401);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'user-1', role: 'team' } });
			// No id set

			const result = await resource.put({ kbId: TEST_KB }, { title: 'Updated' });

			assert.strictEqual(result.status, 400);
		});

		it('updates an existing entry', async () => {
			await tables.KnowledgeEntry.put({
				id: 'put-1',
				kbId: TEST_KB,
				title: 'Original',
				content: 'Original content',
				tags: [],
				confidence: 'verified',
				deprecated: false,
			});

			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'user-1', role: 'team' } });
			resource._setId('put-1');

			const result = await resource.put({ kbId: TEST_KB }, { title: 'Updated Title' });

			assert.strictEqual(result.title, 'Updated Title');
		});

		it('returns 404 for non-existent entry', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'user-1', role: 'team' } });
			resource._setId('missing');

			const result = await resource.put({ kbId: TEST_KB }, { title: 'Updated' });

			assert.strictEqual(result.status, 404);
		});
	});

	describe('DELETE', () => {
		it('requires authentication', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: null });
			resource._setId('some-id');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'user-1', role: 'ai-agent' } });
			resource._setId('some-id');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 403);
		});

		it('deprecates an entry when authorized', async () => {
			await tables.KnowledgeEntry.put({
				id: 'del-1',
				kbId: TEST_KB,
				title: 'To Delete',
				content: 'Body',
				deprecated: false,
			});

			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'admin-1', role: 'team' } });
			resource._setId('del-1');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result, true);

			const entry = await tables.KnowledgeEntry.get('del-1');
			assert.strictEqual(entry.deprecated, true);
		});

		it('returns 400 if no ID is set', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'admin-1', role: 'team' } });

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 400);
		});

		it('returns 404 for non-existent entry', async () => {
			const resource = new KnowledgeEntryResource();
			resource._setContext({ user: { id: 'admin-1', role: 'team' } });
			resource._setId('missing');

			const result = await resource.delete({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
		});
	});
});
