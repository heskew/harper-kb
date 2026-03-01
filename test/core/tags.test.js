/**
 * Tests for core/tags — tag listing and count synchronization.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { listTags, getTag, syncTags } from '../../dist/core/tags.js';

const TEST_KB = 'test-kb';

describe('listTags', () => {
	beforeEach(() => clearAllTables());

	it('returns all tags from the table', async () => {
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:plugins`, kbId: TEST_KB, entryCount: 5 });
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:config`, kbId: TEST_KB, entryCount: 3 });

		const tags = await listTags(TEST_KB);

		assert.strictEqual(tags.length, 2);
		const names = tags.map((t) => t.id).sort();
		assert.deepStrictEqual(names, [`${TEST_KB}:config`, `${TEST_KB}:plugins`]);
	});

	it('returns empty array when no tags exist', async () => {
		const tags = await listTags(TEST_KB);

		assert.deepStrictEqual(tags, []);
	});

	it('only returns tags for the specified kbId (multi-tenant isolation)', async () => {
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:shared`, kbId: TEST_KB, entryCount: 2 });
		await tables.KnowledgeTag.put({ id: 'other-kb:shared', kbId: 'other-kb', entryCount: 5 });
		await tables.KnowledgeTag.put({ id: 'other-kb:exclusive', kbId: 'other-kb', entryCount: 1 });

		const tags = await listTags(TEST_KB);

		assert.strictEqual(tags.length, 1);
		assert.strictEqual(tags[0].id, `${TEST_KB}:shared`);
	});
});

describe('getTag', () => {
	beforeEach(() => clearAllTables());

	it('returns a tag by name', async () => {
		await tables.KnowledgeTag.put({
			id: `${TEST_KB}:security`,
			kbId: TEST_KB,
			entryCount: 2,
			description: 'Security topics',
		});

		const tag = await getTag(TEST_KB, 'security');

		assert.ok(tag);
		assert.strictEqual(tag.id, `${TEST_KB}:security`);
		assert.strictEqual(tag.entryCount, 2);
		assert.strictEqual(tag.description, 'Security topics');
	});

	it('returns null for a non-existent tag', async () => {
		const tag = await getTag(TEST_KB, 'nonexistent');

		assert.strictEqual(tag, null);
	});
});

describe('syncTags', () => {
	beforeEach(() => clearAllTables());

	it('creates new tags with count 1', async () => {
		await syncTags(TEST_KB, ['alpha', 'beta']);

		const alpha = await tables.KnowledgeTag.get(`${TEST_KB}:alpha`);
		const beta = await tables.KnowledgeTag.get(`${TEST_KB}:beta`);

		assert.ok(alpha);
		assert.strictEqual(alpha.entryCount, 1);
		assert.ok(beta);
		assert.strictEqual(beta.entryCount, 1);
	});

	it('increments an existing tag count', async () => {
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:existing`, kbId: TEST_KB, entryCount: 3 });

		await syncTags(TEST_KB, ['existing']);

		const tag = await tables.KnowledgeTag.get(`${TEST_KB}:existing`);
		assert.strictEqual(tag.entryCount, 4);
	});

	it('decrements count for removed tags', async () => {
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:removed`, kbId: TEST_KB, entryCount: 5 });

		// previousTags = ['removed'], newTags = [] -> 'removed' was removed
		await syncTags(TEST_KB, [], ['removed']);

		const tag = await tables.KnowledgeTag.get(`${TEST_KB}:removed`);
		assert.strictEqual(tag.entryCount, 4);
	});

	it('does not decrement below zero', async () => {
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:floor`, kbId: TEST_KB, entryCount: 0 });

		await syncTags(TEST_KB, [], ['floor']);

		const tag = await tables.KnowledgeTag.get(`${TEST_KB}:floor`);
		assert.strictEqual(tag.entryCount, 0);
	});

	it('handles mixed add and remove', async () => {
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:keep`, kbId: TEST_KB, entryCount: 2 });
		await tables.KnowledgeTag.put({ id: `${TEST_KB}:drop`, kbId: TEST_KB, entryCount: 3 });

		// Previous: ['keep', 'drop'], New: ['keep', 'added']
		// 'keep' stays, 'drop' is removed (-1), 'added' is new (+1)
		await syncTags(TEST_KB, ['keep', 'added'], ['keep', 'drop']);

		const keep = await tables.KnowledgeTag.get(`${TEST_KB}:keep`);
		const drop = await tables.KnowledgeTag.get(`${TEST_KB}:drop`);
		const added = await tables.KnowledgeTag.get(`${TEST_KB}:added`);

		assert.strictEqual(keep.entryCount, 2, '"keep" should remain unchanged (in both old and new)');
		assert.strictEqual(drop.entryCount, 2, '"drop" should be decremented');
		assert.ok(added);
		assert.strictEqual(added.entryCount, 1, '"added" should be created with count 1');
	});

	it('handles empty previous tags (new entry scenario)', async () => {
		await syncTags(TEST_KB, ['new-tag']);

		const tag = await tables.KnowledgeTag.get(`${TEST_KB}:new-tag`);
		assert.ok(tag);
		assert.strictEqual(tag.entryCount, 1);
	});
});
