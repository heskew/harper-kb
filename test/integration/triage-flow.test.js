/**
 * Integration test: Submit triage -> List pending -> Process -> Verify
 *
 * End-to-end triage workflow using mock tables.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { submitTriage, processTriage, listPending, dismissTriage } from '../../dist/core/triage.js';
import { getEntry } from '../../dist/core/entries.js';

const TEST_KB = 'test-kb';

describe('Integration: triage flow', () => {
	beforeEach(() => clearAllTables());

	it('submit -> list pending -> accept -> verify entry created', async () => {
		// Step 1: Submit a triage item
		const item = await submitTriage(TEST_KB, 'github-webhook', 'New config pattern discovered', {
			issueNumber: 99,
		});

		assert.ok(item.id);
		assert.strictEqual(item.status, 'pending');

		// Step 2: Verify it appears in pending list
		const pending = await listPending(TEST_KB);
		assert.ok(pending.length >= 1);
		const pendingItem = pending.find((p) => p.id === item.id);
		assert.ok(pendingItem, 'Submitted item should appear in pending list');

		// Step 3: Process as accepted, creating a knowledge entry
		const processed = await processTriage(item.id, 'accepted', 'reviewer-admin', {
			entryData: {
				title: 'New Config Pattern',
				content: 'Use the new config.yaml pattern for dynamic plugins.',
				tags: ['config', 'plugins'],
			},
		});

		assert.strictEqual(processed.status, 'accepted');
		assert.ok(processed.draftEntryId, 'Should have created a knowledge entry');

		// Step 4: Verify the knowledge entry was created
		const entry = await getEntry(processed.draftEntryId);
		assert.ok(entry);
		assert.strictEqual(entry.title, 'New Config Pattern');
		assert.deepStrictEqual(entry.tags, ['config', 'plugins']);
		assert.strictEqual(entry.kbId, TEST_KB);

		// Step 5: Verify the item no longer appears in pending list
		const pendingAfter = await listPending(TEST_KB);
		const stillPending = pendingAfter.find((p) => p.id === item.id);
		assert.ok(!stillPending, 'Processed item should no longer be pending');
	});

	it('submit -> dismiss -> verify no entry created', async () => {
		// Step 1: Submit a triage item
		const item = await submitTriage(TEST_KB, 'slack-bot', 'Possible duplicate knowledge');

		// Step 2: Dismiss it
		await dismissTriage(item.id, 'admin');

		// Step 3: Verify it's dismissed
		const stored = await tables.TriageItem.get(item.id);
		assert.strictEqual(stored.status, 'dismissed');
		assert.strictEqual(stored.processedBy, 'admin');

		// Step 4: Verify no knowledge entry was created
		assert.strictEqual(stored.draftEntryId, undefined, 'No entry should be created for dismissed items');

		// Step 5: Verify it does not appear in pending list
		const pending = await listPending(TEST_KB);
		const found = pending.find((p) => p.id === item.id);
		assert.ok(!found, 'Dismissed item should not appear in pending list');
	});

	it('submit -> link to existing -> verify linkage', async () => {
		// Seed an existing entry
		await tables.KnowledgeEntry.put({
			id: 'existing-entry',
			kbId: TEST_KB,
			title: 'Existing Knowledge',
			content: 'Already documented',
			tags: ['known'],
			confidence: 'verified',
		});

		// Step 1: Submit a triage item
		const item = await submitTriage(TEST_KB, 'support-ticket', 'Customer asked about known topic');

		// Step 2: Link to existing entry
		const processed = await processTriage(item.id, 'linked', 'support-agent', {
			linkedEntryId: 'existing-entry',
		});

		assert.strictEqual(processed.status, 'linked');
		assert.strictEqual(processed.matchedEntryId, 'existing-entry');
	});

	it('multiple items flow through the pipeline independently', async () => {
		// Submit multiple items
		const item1 = await submitTriage(TEST_KB, 'webhook-a', 'First item');
		const item2 = await submitTriage(TEST_KB, 'webhook-b', 'Second item');
		const item3 = await submitTriage(TEST_KB, 'webhook-c', 'Third item');

		// All should be pending
		let pending = await listPending(TEST_KB);
		assert.strictEqual(pending.length, 3);

		// Process first as accepted
		await processTriage(item1.id, 'accepted', 'user-a', {
			entryData: { title: 'From First', content: 'Content', tags: [] },
		});

		// Dismiss second
		await dismissTriage(item2.id, 'user-b');

		// Only third should remain pending
		pending = await listPending(TEST_KB);
		assert.strictEqual(pending.length, 1);
		assert.strictEqual(pending[0].id, item3.id);
	});
});
