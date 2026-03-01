/**
 * Integration test: Create entry -> Search -> Find it
 *
 * End-to-end flow using mock tables and keyword search mode
 * (avoids dependency on the embedding model).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { createEntry } from '../../dist/core/entries.js';
import { search } from '../../dist/core/search.js';

const TEST_KB = 'test-kb';

describe('Integration: search flow', () => {
	beforeEach(() => clearAllTables());

	it('creates an entry and finds it via keyword search', async () => {
		// Step 1: Create an entry
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'How to configure resource plugins in Harper',
			content: 'Resource plugins are configured via config.yaml using the package key.',
			tags: ['plugins', 'config'],
		});

		assert.ok(entry.id);

		// Step 2: Search for it by keyword
		const results = await search({
			kbId: TEST_KB,
			query: 'resource plugins',
			mode: 'keyword',
		});

		// Step 3: Verify it appears in results
		const found = results.find((r) => r.id === entry.id);
		assert.ok(found, 'Created entry should be found in search results');
		assert.strictEqual(found.title, 'How to configure resource plugins in Harper');
		assert.strictEqual(found.matchType, 'keyword');
		assert.ok(found.score > 0, 'Score should be positive');
	});

	it('finds entries by content match', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Getting Started',
			content: 'To install Harper, run npm install harperdb and then harperdb run.',
			tags: ['setup'],
		});

		const results = await search({ kbId: TEST_KB, query: 'install', mode: 'keyword' });

		const found = results.find((r) => r.id === entry.id);
		assert.ok(found, 'Entry should be found by content match');
		assert.strictEqual(found.score, 0.7, 'Content match should get lower score (0.7)');
	});

	it('filters by tags in search', async () => {
		await createEntry({
			kbId: TEST_KB,
			title: 'Plugin setup',
			content: 'How to set up plugins',
			tags: ['plugins'],
		});

		await createEntry({
			kbId: TEST_KB,
			title: 'Security setup',
			content: 'How to set up security',
			tags: ['security'],
		});

		const results = await search({
			kbId: TEST_KB,
			query: 'setup',
			mode: 'keyword',
			tags: ['plugins'],
		});

		assert.ok(results.length >= 1);
		const tags = results.map((r) => r.tags).flat();
		assert.ok(tags.includes('plugins'), 'Results should include the plugins tag');
		const securityResults = results.filter((r) => r.tags.includes('security') && !r.tags.includes('plugins'));
		assert.strictEqual(securityResults.length, 0, 'Security-only entries should be filtered out');
	});

	it('does not return deprecated entries', async () => {
		const entry = await createEntry({
			kbId: TEST_KB,
			title: 'Old approach to plugin config',
			content: 'This is deprecated',
			tags: ['plugins'],
		});

		// Deprecate it
		await tables.KnowledgeEntry.put({
			...(await tables.KnowledgeEntry.get(entry.id)),
			kbId: TEST_KB,
			deprecated: true,
		});

		const results = await search({ kbId: TEST_KB, query: 'plugin config', mode: 'keyword' });

		const found = results.find((r) => r.id === entry.id);
		assert.ok(!found, 'Deprecated entries should not appear in search results');
	});

	it('applies applicability context to boost matching results', async () => {
		const linuxEntry = await createEntry({
			kbId: TEST_KB,
			title: 'Linux plugin deployment',
			content: 'Deploy plugins on Linux systems',
			tags: ['plugins'],
			appliesTo: { platform: 'linux' },
		});

		const winEntry = await createEntry({
			kbId: TEST_KB,
			title: 'Windows plugin deployment',
			content: 'Deploy plugins on Windows systems',
			tags: ['plugins'],
			appliesTo: { platform: 'win32' },
		});

		// Search as a Linux user
		const results = await search({
			kbId: TEST_KB,
			query: 'plugin deployment',
			mode: 'keyword',
			context: { platform: 'linux' },
		});

		const linuxResult = results.find((r) => r.id === linuxEntry.id);
		const winResult = results.find((r) => r.id === winEntry.id);

		if (linuxResult && winResult) {
			assert.ok(linuxResult.score > winResult.score, 'Linux entry should score higher for a Linux user');
		}
	});

	it('logs the search query to QueryLog', async () => {
		await createEntry({ kbId: TEST_KB, title: 'Logged query target', content: 'Content' });

		await search({ kbId: TEST_KB, query: 'Logged query', mode: 'keyword' });

		const logs = [];
		for await (const item of tables.QueryLog.search({})) {
			logs.push(item);
		}

		assert.ok(logs.length > 0, 'Should have at least one query log');
		const log = logs.find((l) => l.query === 'Logged query');
		assert.ok(log, 'Query should be logged');
		assert.ok(typeof log.resultCount === 'number');
	});
});
