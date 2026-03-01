/**
 * Tests for core/history — edit history tracking for knowledge entries.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { logEdit, getHistory } from '../../dist/core/history.js';
import { createEntry, updateEntry } from '../../dist/core/entries.js';

const TEST_KB = 'test-kb';

describe('logEdit', () => {
	beforeEach(() => clearAllTables());

	it('creates an edit record with changed fields', async () => {
		const previous = {
			id: 'entry-1',
			kbId: TEST_KB,
			title: 'Original Title',
			content: 'Original content',
			tags: ['tag1'],
			confidence: 'ai-generated',
		};
		const updated = {
			id: 'entry-1',
			kbId: TEST_KB,
			title: 'Updated Title',
			content: 'Original content',
			tags: ['tag1'],
			confidence: 'reviewed',
		};

		const edit = await logEdit(TEST_KB, 'entry-1', previous, updated, 'testuser', 'Fixed title and confidence');

		assert.ok(edit.id, 'Edit should have an id');
		assert.strictEqual(edit.entryId, 'entry-1');
		assert.strictEqual(edit.editedBy, 'testuser');
		assert.strictEqual(edit.editSummary, 'Fixed title and confidence');
		assert.ok(edit.changedFields.includes('title'));
		assert.ok(edit.changedFields.includes('confidence'));
		assert.ok(!edit.changedFields.includes('content'), 'Unchanged fields should not be listed');
		assert.strictEqual(edit.previousSnapshot.title, 'Original Title');
		assert.strictEqual(edit.previousSnapshot.confidence, 'ai-generated');
	});

	it('stores the edit in KnowledgeEntryEdit table', async () => {
		const previous = {
			id: 'e1',
			kbId: TEST_KB,
			title: 'Old',
			content: 'Body',
			tags: [],
			confidence: 'verified',
		};
		const updated = {
			id: 'e1',
			kbId: TEST_KB,
			title: 'New',
			content: 'Body',
			tags: [],
			confidence: 'verified',
		};

		const edit = await logEdit(TEST_KB, 'e1', previous, updated, 'user1');

		const stored = await tables.KnowledgeEntryEdit.get(edit.id);
		assert.ok(stored, 'Edit record should be stored');
		assert.strictEqual(stored.entryId, 'e1');
		assert.strictEqual(stored.editedBy, 'user1');
	});

	it('detects array field changes (tags)', async () => {
		const previous = {
			id: 'e2',
			kbId: TEST_KB,
			title: 'T',
			content: 'C',
			tags: ['a', 'b'],
			confidence: 'verified',
		};
		const updated = {
			id: 'e2',
			kbId: TEST_KB,
			title: 'T',
			content: 'C',
			tags: ['a', 'c'],
			confidence: 'verified',
		};

		const edit = await logEdit(TEST_KB, 'e2', previous, updated, 'user2');

		assert.ok(edit.changedFields.includes('tags'));
		assert.deepStrictEqual(edit.previousSnapshot.tags, ['a', 'b']);
	});

	it('detects object field changes (appliesTo)', async () => {
		const previous = {
			id: 'e3',
			kbId: TEST_KB,
			title: 'T',
			content: 'C',
			tags: [],
			confidence: 'verified',
			appliesTo: { product: '>=4.6.0' },
		};
		const updated = {
			id: 'e3',
			kbId: TEST_KB,
			title: 'T',
			content: 'C',
			tags: [],
			confidence: 'verified',
			appliesTo: { product: '>=5.0.0' },
		};

		const edit = await logEdit(TEST_KB, 'e3', previous, updated, 'user3');

		assert.ok(edit.changedFields.includes('appliesTo'));
		assert.deepStrictEqual(edit.previousSnapshot.appliesTo, {
			product: '>=4.6.0',
		});
	});

	it('returns empty changedFields when nothing changed', async () => {
		const entry = {
			id: 'e4',
			kbId: TEST_KB,
			title: 'T',
			content: 'C',
			tags: ['x'],
			confidence: 'verified',
		};

		const edit = await logEdit(TEST_KB, 'e4', entry, entry, 'user4');

		assert.deepStrictEqual(edit.changedFields, []);
		assert.deepStrictEqual(edit.previousSnapshot, {});
	});
});

describe('getHistory', () => {
	beforeEach(() => clearAllTables());

	it('returns edits for a specific entry', async () => {
		// Create two edits for entry-1 and one for entry-2
		await logEdit(
			TEST_KB,
			'entry-1',
			{
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'A',
				content: 'C',
				tags: [],
				confidence: 'verified',
			},
			{
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'B',
				content: 'C',
				tags: [],
				confidence: 'verified',
			},
			'user1'
		);
		await logEdit(
			TEST_KB,
			'entry-1',
			{
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'B',
				content: 'C',
				tags: [],
				confidence: 'verified',
			},
			{
				id: 'entry-1',
				kbId: TEST_KB,
				title: 'C',
				content: 'C',
				tags: [],
				confidence: 'verified',
			},
			'user2'
		);
		await logEdit(
			TEST_KB,
			'entry-2',
			{
				id: 'entry-2',
				kbId: TEST_KB,
				title: 'X',
				content: 'C',
				tags: [],
				confidence: 'verified',
			},
			{
				id: 'entry-2',
				kbId: TEST_KB,
				title: 'Y',
				content: 'C',
				tags: [],
				confidence: 'verified',
			},
			'user3'
		);

		const history = await getHistory('entry-1');

		assert.strictEqual(history.length, 2, 'Should only return edits for entry-1');
		assert.ok(history.every((e) => e.entryId === 'entry-1'));
	});

	it('returns empty array when no edits exist', async () => {
		const history = await getHistory('no-edits');

		assert.deepStrictEqual(history, []);
	});

	it('respects the limit parameter', async () => {
		// Create 5 edits
		for (let i = 0; i < 5; i++) {
			await logEdit(
				TEST_KB,
				'entry-lim',
				{
					id: 'entry-lim',
					kbId: TEST_KB,
					title: `V${i}`,
					content: 'C',
					tags: [],
					confidence: 'verified',
				},
				{
					id: 'entry-lim',
					kbId: TEST_KB,
					title: `V${i + 1}`,
					content: 'C',
					tags: [],
					confidence: 'verified',
				},
				'user'
			);
		}

		const limited = await getHistory('entry-lim', 3);

		assert.strictEqual(limited.length, 3);
	});
});

describe('updateEntry with edit tracking', () => {
	beforeEach(() => clearAllTables());

	it('logs an edit when editedBy is provided', async () => {
		await createEntry({
			kbId: TEST_KB,
			id: 'track-1',
			title: 'Original',
			content: 'Content',
			tags: ['test'],
		});

		await updateEntry(
			'track-1',
			{ title: 'Changed' },
			{
				editedBy: 'editor1',
				editSummary: 'Updated the title',
			}
		);

		const history = await getHistory('track-1');
		assert.strictEqual(history.length, 1);
		assert.strictEqual(history[0].editedBy, 'editor1');
		assert.strictEqual(history[0].editSummary, 'Updated the title');
		assert.ok(history[0].changedFields.includes('title'));
		assert.strictEqual(history[0].previousSnapshot.title, 'Original');
	});

	it('does not log an edit when editedBy is not provided', async () => {
		await createEntry({
			kbId: TEST_KB,
			id: 'track-2',
			title: 'Original',
			content: 'Content',
		});

		await updateEntry('track-2', { title: 'Changed' });

		const history = await getHistory('track-2');
		assert.strictEqual(history.length, 0);
	});
});
