/**
 * Tests for core/triage — triage queue submission, processing, and listing.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { submitTriage, processTriage, listPending, dismissTriage } from '../../dist/core/triage.js';

const TEST_KB = 'test-kb';

describe('submitTriage', () => {
	beforeEach(() => clearAllTables());

	it('creates a triage item with status "pending"', async () => {
		const item = await submitTriage(TEST_KB, 'github-webhook', 'New issue about config');

		assert.ok(item.id);
		assert.strictEqual(item.kbId, TEST_KB);
		assert.strictEqual(item.source, 'github-webhook');
		assert.strictEqual(item.summary, 'New issue about config');
		assert.strictEqual(item.status, 'pending');
	});

	it('generates a UUID for the item id', async () => {
		const item = await submitTriage(TEST_KB, 'slack', 'User question');

		assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('stores the rawPayload', async () => {
		const payload = {
			issueNumber: 42,
			url: 'https://github.com/ex/repo/issues/42',
		};
		const item = await submitTriage(TEST_KB, 'github', 'Issue 42', payload);

		const stored = await tables.TriageItem.get(item.id);
		assert.deepStrictEqual(stored.rawPayload, payload);
	});

	it('stores null rawPayload when none is provided', async () => {
		const item = await submitTriage(TEST_KB, 'manual', 'No payload');

		const stored = await tables.TriageItem.get(item.id);
		assert.strictEqual(stored.rawPayload, null);
	});
});

describe('processTriage', () => {
	beforeEach(() => clearAllTables());

	it('updates status and processedBy', async () => {
		const item = await submitTriage(TEST_KB, 'webhook', 'Test item');

		const processed = await processTriage(item.id, 'dismissed', 'admin-user');

		assert.strictEqual(processed.status, 'dismissed');
		assert.strictEqual(processed.action, 'dismissed');
		assert.strictEqual(processed.processedBy, 'admin-user');
		assert.ok(processed.processedAt instanceof Date);
	});

	it('throws for a non-existent item', async () => {
		await assert.rejects(() => processTriage('missing-id', 'dismissed', 'user'), {
			message: 'Triage item not found: missing-id',
		});
	});

	it('creates a knowledge entry when accepted with entryData', async () => {
		const item = await submitTriage(TEST_KB, 'manual', 'New knowledge');

		const processed = await processTriage(item.id, 'accepted', 'reviewer', {
			entryData: {
				title: 'Accepted Entry',
				content: 'Content from triage',
				tags: ['triage'],
			},
		});

		assert.strictEqual(processed.status, 'accepted');
		assert.ok(processed.draftEntryId, 'Should have a draft entry ID');

		// Verify the knowledge entry was created
		const entry = await tables.KnowledgeEntry.get(processed.draftEntryId);
		assert.ok(entry);
		assert.strictEqual(entry.title, 'Accepted Entry');
		assert.strictEqual(entry.kbId, TEST_KB);
	});

	it('links to an existing entry when action is "linked"', async () => {
		const item = await submitTriage(TEST_KB, 'webhook', 'Linked item');

		const processed = await processTriage(item.id, 'linked', 'user', {
			linkedEntryId: 'existing-entry-123',
		});

		assert.strictEqual(processed.status, 'linked');
		assert.strictEqual(processed.matchedEntryId, 'existing-entry-123');
	});
});

describe('listPending', () => {
	beforeEach(() => clearAllTables());

	it('returns only pending items', async () => {
		const pending1 = await submitTriage(TEST_KB, 'source-a', 'Pending 1');
		const pending2 = await submitTriage(TEST_KB, 'source-b', 'Pending 2');
		await submitTriage(TEST_KB, 'source-c', 'Will dismiss');

		// Dismiss the third item
		await processTriage(
			(
				await tables.TriageItem.search({
					conditions: [
						{
							attribute: 'summary',
							comparator: 'equals',
							value: 'Will dismiss',
						},
					],
				})
					[Symbol.asyncIterator]()
					.next()
			).value.id,
			'dismissed',
			'admin'
		);

		const pending = await listPending(TEST_KB);
		const pendingIds = pending.map((p) => p.id);

		assert.ok(pendingIds.includes(pending1.id), 'First pending item should be listed');
		assert.ok(pendingIds.includes(pending2.id), 'Second pending item should be listed');
		assert.strictEqual(pending.length, 2, 'Should only have 2 pending items');
	});

	it('returns empty array when no pending items', async () => {
		const pending = await listPending(TEST_KB);

		assert.deepStrictEqual(pending, []);
	});
});

describe('dismissTriage', () => {
	beforeEach(() => clearAllTables());

	it('sets status to dismissed', async () => {
		const item = await submitTriage(TEST_KB, 'webhook', 'To dismiss');

		await dismissTriage(item.id, 'admin');

		const stored = await tables.TriageItem.get(item.id);
		assert.strictEqual(stored.status, 'dismissed');
		assert.strictEqual(stored.processedBy, 'admin');
	});

	it('throws for non-existent item (via processTriage)', async () => {
		await assert.rejects(() => dismissTriage('missing', 'user'), {
			message: 'Triage item not found: missing',
		});
	});
});
