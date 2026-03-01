/**
 * Tests for core/entries — CRUD and relationship management for knowledge entries.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import {
	createEntry,
	getEntry,
	updateEntry,
	deprecateEntry,
	linkSupersedes,
	linkSiblings,
	linkRelated,
} from '../../dist/core/entries.js';

const TEST_KB = 'test-kb';

describe('createEntry', () => {
	beforeEach(() => clearAllTables());

	it('creates an entry with a generated UUID when no id is provided', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Test Entry',
			content: 'Some content',
		});

		assert.ok(entry.id, 'Entry should have an id');
		// UUID v4 format check
		assert.match(entry.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		assert.strictEqual(entry.title, 'Test Entry');
		assert.strictEqual(entry.content, 'Some content');
	});

	it('uses the provided id if given', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Custom ID',
			content: 'Body',
			id: 'my-custom-id',
		});

		assert.strictEqual(entry.id, 'my-custom-id');
	});

	it('sets default confidence to ai-generated', async () => {
		const entry = await createEntry({ kbId: TEST_KB, title: 'Title', content: 'Content' });

		assert.strictEqual(entry.confidence, 'ai-generated');
	});

	it('stores the entry in the KnowledgeEntry table', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Stored',
			content: 'Check storage',
		});

		const stored = await tables.KnowledgeEntry.get(entry.id);
		assert.ok(stored, 'Entry should be stored in the table');
		assert.strictEqual(stored.title, 'Stored');
	});

	it('sets default tags to empty array', async () => {
		const entry = await createEntry({ kbId: TEST_KB, title: 'No Tags', content: 'Body' });

		assert.deepStrictEqual(entry.tags, []);
	});

	it('sets deprecated to false by default', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Not Deprecated',
			content: 'Body',
		});

		assert.strictEqual(entry.deprecated, false);
	});

	it('syncs tags when tags are provided', async () => {
		await createEntry({
			kbId: TEST_KB,
			title: 'Tagged',
			content: 'Body',
			tags: ['plugin', 'config'],
		});

		const pluginTag = await tables.KnowledgeTag.get(`${TEST_KB}:plugin`);
		const configTag = await tables.KnowledgeTag.get(`${TEST_KB}:config`);

		assert.ok(pluginTag, 'plugin tag should be created');
		assert.strictEqual(pluginTag.entryCount, 1);
		assert.ok(configTag, 'config tag should be created');
		assert.strictEqual(configTag.entryCount, 1);
	});

	it('handles embedding generation failure gracefully', async () => {
		// The embedding model is not initialized in tests, so generateEmbedding will throw.
		// createEntry should catch the error and continue with embedding: undefined.
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'No Embedding',
			content: 'Content',
		});

		assert.ok(entry.id);
		assert.strictEqual(entry.embedding, undefined);
	});

	it('preserves optional fields when provided', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Full Entry',
			content: 'Full content',
			source: 'github-issue',
			sourceUrl: 'https://github.com/example/issue/1',
			confidence: 'verified',
			addedBy: 'tester',
			appliesTo: { product: '>=4.6.0', platform: 'linux' },
			metadata: { plan: 'enterprise' },
		});

		assert.strictEqual(entry.source, 'github-issue');
		assert.strictEqual(entry.sourceUrl, 'https://github.com/example/issue/1');
		assert.strictEqual(entry.confidence, 'verified');
		assert.strictEqual(entry.addedBy, 'tester');
		assert.deepStrictEqual(entry.appliesTo, {
			product: '>=4.6.0',
			platform: 'linux',
		});
		assert.deepStrictEqual(entry.metadata, { plan: 'enterprise' });
	});
});

describe('getEntry', () => {
	beforeEach(() => clearAllTables());

	it('returns null for a non-existent id', async () => {
		const result = await getEntry('nonexistent');

		assert.strictEqual(result, null);
	});

	it('returns a stored entry', async () => {
		await tables.KnowledgeEntry.put({
			id: 'existing-1',
			kbId: TEST_KB,
			title: 'Existing',
			content: 'Body',
			tags: ['test'],
			confidence: 'verified',
		});

		const result = await getEntry('existing-1');

		assert.ok(result);
		assert.strictEqual(result.title, 'Existing');
		assert.strictEqual(result.confidence, 'verified');
	});
});

describe('updateEntry', () => {
	beforeEach(() => clearAllTables());

	it('merges data with the existing entry', async () => {
		await tables.KnowledgeEntry.put({
			id: 'up-1',
			kbId: TEST_KB,
			title: 'Original',
			content: 'Original content',
			tags: ['old'],
			confidence: 'ai-generated',
			deprecated: false,
		});

		const updated = await updateEntry('up-1', { title: 'Updated Title' });

		assert.strictEqual(updated.title, 'Updated Title');
		assert.strictEqual(updated.content, 'Original content'); // Unchanged
		assert.strictEqual(updated.id, 'up-1'); // ID preserved
	});

	it('throws for a non-existent entry', async () => {
		await assert.rejects(() => updateEntry('missing', { title: 'New' }), {
			message: 'Knowledge entry not found: missing',
		});
	});

	it('syncs tags when tags change', async () => {
		await tables.KnowledgeEntry.put({
			id: 'tag-update-1',
			kbId: TEST_KB,
			title: 'Title',
			content: 'Content',
			tags: ['old-tag'],
			confidence: 'verified',
		});
		// Create the old tag with a count
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:old-tag`, kbId: TEST_KB, entryCount: 1 });

		await updateEntry('tag-update-1', { tags: ['new-tag'] });

		const oldTag = await tables.KnowledgeTag.get(`${TEST_KB}:old-tag`);
		const newTag = await tables.KnowledgeTag.get(`${TEST_KB}:new-tag`);

		assert.strictEqual(oldTag.entryCount, 0, 'old tag count should be decremented');
		assert.ok(newTag, 'new tag should be created');
		assert.strictEqual(newTag.entryCount, 1);
	});

	it('does not overwrite the id field', async () => {
		await tables.KnowledgeEntry.put({
			id: 'keep-id',
			kbId: TEST_KB,
			title: 'Title',
			content: 'Content',
			tags: [],
			confidence: 'verified',
		});

		// Even though KnowledgeEntryUpdate type doesn't have id, the spread
		// should never allow it to be overwritten because of the explicit id assignment.
		const updated = await updateEntry('keep-id', { title: 'Changed' });
		assert.strictEqual(updated.id, 'keep-id');
	});
});

describe('deprecateEntry', () => {
	beforeEach(() => clearAllTables());

	it('sets deprecated to true', async () => {
		await tables.KnowledgeEntry.put({
			id: 'dep-1',
			kbId: TEST_KB,
			title: 'To Deprecate',
			content: 'Body',
			deprecated: false,
		});

		await deprecateEntry('dep-1');

		const entry = await tables.KnowledgeEntry.get('dep-1');
		assert.strictEqual(entry.deprecated, true);
	});

	it('throws for a non-existent entry', async () => {
		await assert.rejects(() => deprecateEntry('nonexistent'), {
			message: 'Knowledge entry not found: nonexistent',
		});
	});
});

describe('linkSupersedes', () => {
	beforeEach(() => clearAllTables());

	it('sets both sides of the supersession relationship', async () => {
		await tables.KnowledgeEntry.put({
			id: 'new-1',
			kbId: TEST_KB,
			title: 'New',
			content: 'New version',
		});
		await tables.KnowledgeEntry.put({
			id: 'old-1',
			kbId: TEST_KB,
			title: 'Old',
			content: 'Old version',
		});

		await linkSupersedes('new-1', 'old-1');

		const newEntry = await tables.KnowledgeEntry.get('new-1');
		const oldEntry = await tables.KnowledgeEntry.get('old-1');

		assert.strictEqual(newEntry.supersedesId, 'old-1');
		assert.strictEqual(oldEntry.supersededById, 'new-1');
	});

	it('throws if new entry does not exist', async () => {
		await tables.KnowledgeEntry.put({
			id: 'old-2',
			kbId: TEST_KB,
			title: 'Old',
			content: 'Body',
		});

		await assert.rejects(() => linkSupersedes('missing', 'old-2'), {
			message: 'New entry not found: missing',
		});
	});

	it('throws if old entry does not exist', async () => {
		await tables.KnowledgeEntry.put({
			id: 'new-2',
			kbId: TEST_KB,
			title: 'New',
			content: 'Body',
		});

		await assert.rejects(() => linkSupersedes('new-2', 'missing'), {
			message: 'Old entry not found: missing',
		});
	});
});

describe('linkSiblings', () => {
	beforeEach(() => clearAllTables());

	it('adds all other IDs to each entry siblingIds', async () => {
		await tables.KnowledgeEntry.put({ id: 'a', kbId: TEST_KB, title: 'A', content: 'A' });
		await tables.KnowledgeEntry.put({ id: 'b', kbId: TEST_KB, title: 'B', content: 'B' });
		await tables.KnowledgeEntry.put({ id: 'c', kbId: TEST_KB, title: 'C', content: 'C' });

		await linkSiblings(['a', 'b', 'c']);

		const a = await tables.KnowledgeEntry.get('a');
		const b = await tables.KnowledgeEntry.get('b');
		const c = await tables.KnowledgeEntry.get('c');

		assert.deepStrictEqual(a.siblingIds.sort(), ['b', 'c']);
		assert.deepStrictEqual(b.siblingIds.sort(), ['a', 'c']);
		assert.deepStrictEqual(c.siblingIds.sort(), ['a', 'b']);
	});

	it('handles fewer than 2 IDs gracefully (no-op)', async () => {
		await tables.KnowledgeEntry.put({
			id: 'solo',
			kbId: TEST_KB,
			title: 'Solo',
			content: 'Alone',
		});

		// Should not throw and should not modify the entry
		await linkSiblings(['solo']);
		await linkSiblings([]);

		const entry = await tables.KnowledgeEntry.get('solo');
		assert.strictEqual(entry.siblingIds, undefined);
	});

	it('deduplicates sibling IDs when called multiple times', async () => {
		await tables.KnowledgeEntry.put({ id: 'x', kbId: TEST_KB, title: 'X', content: 'X' });
		await tables.KnowledgeEntry.put({ id: 'y', kbId: TEST_KB, title: 'Y', content: 'Y' });

		await linkSiblings(['x', 'y']);
		await linkSiblings(['x', 'y']); // Call again — should not duplicate

		const x = await tables.KnowledgeEntry.get('x');
		assert.deepStrictEqual(x.siblingIds, ['y']);
	});
});

describe('linkRelated', () => {
	beforeEach(() => clearAllTables());

	it('adds relatedId to the entry relatedIds array', async () => {
		await tables.KnowledgeEntry.put({
			id: 'entry-1',
			kbId: TEST_KB,
			title: 'E1',
			content: 'C1',
		});

		await linkRelated('entry-1', 'related-1');

		const entry = await tables.KnowledgeEntry.get('entry-1');
		assert.deepStrictEqual(entry.relatedIds, ['related-1']);
	});

	it('deduplicates related IDs', async () => {
		await tables.KnowledgeEntry.put({
			id: 'entry-2',
			kbId: TEST_KB,
			title: 'E2',
			content: 'C2',
		});

		await linkRelated('entry-2', 'related-1');
		await linkRelated('entry-2', 'related-1'); // Duplicate

		const entry = await tables.KnowledgeEntry.get('entry-2');
		assert.deepStrictEqual(entry.relatedIds, ['related-1']);
	});

	it('appends additional related IDs', async () => {
		await tables.KnowledgeEntry.put({
			id: 'entry-3',
			kbId: TEST_KB,
			title: 'E3',
			content: 'C3',
		});

		await linkRelated('entry-3', 'related-a');
		await linkRelated('entry-3', 'related-b');

		const entry = await tables.KnowledgeEntry.get('entry-3');
		assert.deepStrictEqual(entry.relatedIds.sort(), ['related-a', 'related-b']);
	});

	it('throws for a non-existent entry', async () => {
		await assert.rejects(() => linkRelated('nonexistent', 'some-id'), {
			message: 'Entry not found: nonexistent',
		});
	});
});
