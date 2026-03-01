/**
 * Tests for HistoryResource — REST endpoint for edit history.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { HistoryResource } from '../../dist/resources/HistoryResource.js';

const TEST_KB = 'test-kb';

describe('HistoryResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET', () => {
		it('returns 400 when kbId is missing', async () => {
			const resource = new HistoryResource();
			resource._setId('entry-1');
			const result = await resource.get({});
			assert.strictEqual(result.status, 400);
			assert.ok(result.data.error.includes('kbId'));
		});

		it('returns 400 when entry ID is missing', async () => {
			const resource = new HistoryResource();
			const result = await resource.get({ kbId: TEST_KB });
			assert.strictEqual(result.status, 400);
			assert.ok(result.data.error.includes('Entry ID required'));
		});

		it('returns 404 for non-existent entry', async () => {
			const resource = new HistoryResource();
			resource._setId('nonexistent');
			const result = await resource.get({ kbId: TEST_KB });
			assert.strictEqual(result.status, 404);
		});

		it('returns 404 when entry belongs to a different KB', async () => {
			await tables.KnowledgeEntry.put({
				id: 'entry-1',
				kbId: 'other-kb',
				title: 'Test',
				content: 'Content',
			});
			const resource = new HistoryResource();
			resource._setId('entry-1');
			const result = await resource.get({ kbId: TEST_KB });
			assert.strictEqual(result.status, 404);
		});

		it('returns edit history for a valid entry', async () => {
			await tables.KnowledgeEntry.put({
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'Test Entry',
				content: 'Content',
			});
			await tables.KnowledgeEntryEdit.put({
				id: 'edit-1',
				kbId: TEST_KB,
				entryId: 'entry-1',
				editSummary: 'Updated title',
				changedFields: ['title'],
				editedBy: 'user1',
				createdAt: new Date().toISOString(),
			});

			const resource = new HistoryResource();
			resource._setId('entry-1');
			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.entryId, 'entry-1');
			assert.strictEqual(result.editCount, 1);
			assert.ok(Array.isArray(result.edits));
			assert.strictEqual(result.edits[0].editSummary, 'Updated title');
		});

		it('strips sensitive fields (editedBy, previousValues)', async () => {
			await tables.KnowledgeEntry.put({
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'Test',
				content: 'Content',
			});
			await tables.KnowledgeEntryEdit.put({
				id: 'edit-1',
				kbId: TEST_KB,
				entryId: 'entry-1',
				editSummary: 'Changed',
				changedFields: ['title'],
				editedBy: 'secret-user',
				previousValues: { title: 'Old Title' },
				createdAt: new Date().toISOString(),
			});

			const resource = new HistoryResource();
			resource._setId('entry-1');
			const result = await resource.get({ kbId: TEST_KB });

			const edit = result.edits[0];
			assert.strictEqual(edit.editedBy, undefined);
			assert.strictEqual(edit.previousValues, undefined);
		});

		it('returns empty edits when no history exists', async () => {
			await tables.KnowledgeEntry.put({
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'Test',
				content: 'Content',
			});

			const resource = new HistoryResource();
			resource._setId('entry-1');
			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.editCount, 0);
			assert.deepStrictEqual(result.edits, []);
		});

		it('reads kbId from target.get() method', async () => {
			await tables.KnowledgeEntry.put({
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'Test',
				content: 'Content',
			});

			const resource = new HistoryResource();
			resource._setId('entry-1');
			const target = { get: (key) => (key === 'kbId' ? TEST_KB : null) };
			const result = await resource.get(target);

			assert.strictEqual(result.entryId, 'entry-1');
		});
	});
});
