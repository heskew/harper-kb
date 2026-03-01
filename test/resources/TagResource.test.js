/**
 * Tests for TagResource — REST endpoint for knowledge tags (public, read-only).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { TagResource } from '../../dist/resources/TagResource.js';

const TEST_KB = 'test-kb';

describe('TagResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET (list)', () => {
		it('returns all tags (no auth required)', async () => {
			await tables.KnowledgeTag.put({ id: `${TEST_KB}:plugins`, kbId: TEST_KB, entryCount: 5 });
			await tables.KnowledgeTag.put({ id: `${TEST_KB}:config`, kbId: TEST_KB, entryCount: 3 });

			const resource = new TagResource();
			// No auth context set — should still work (public endpoint)

			const result = await resource.get({ kbId: TEST_KB });

			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 2);
		});

		it('returns empty array when no tags exist', async () => {
			const resource = new TagResource();

			const result = await resource.get({ kbId: TEST_KB });

			assert.deepStrictEqual(result, []);
		});
	});

	describe('GET (by ID)', () => {
		it('returns a single tag by name', async () => {
			await tables.KnowledgeTag.put({
				id: `${TEST_KB}:security`,
				kbId: TEST_KB,
				entryCount: 7,
				description: 'Security topics',
			});

			const resource = new TagResource();
			resource._setId('security');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.id, `${TEST_KB}:security`);
			assert.strictEqual(result.entryCount, 7);
			assert.strictEqual(result.description, 'Security topics');
		});

		it('returns 404 for non-existent tag', async () => {
			const resource = new TagResource();
			resource._setId('nonexistent');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
			assert.strictEqual(result.data.error, 'Tag not found');
		});
	});
});
