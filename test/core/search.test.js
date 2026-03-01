/**
 * Tests for core/search — keyword, semantic, and hybrid search with applicability filtering.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { search, filterByApplicability } from '../../dist/core/search.js';

const TEST_KB = 'test-kb';

/**
 * Seed a knowledge entry directly into the mock table.
 */
function seedEntry(fields) {
	const entry = {
		id: fields.id || `entry-${Math.random().toString(36).slice(2, 8)}`,
		kbId: fields.kbId || TEST_KB,
		title: fields.title || 'Untitled',
		content: fields.content || '',
		tags: fields.tags || [],
		confidence: fields.confidence || 'verified',
		deprecated: fields.deprecated ?? false,
		appliesTo: fields.appliesTo || undefined,
		...fields,
	};
	tables.KnowledgeEntry._store.set(String(entry.id), entry);
	return entry;
}

describe('search — keyword mode', () => {
	beforeEach(() => clearAllTables());

	it('returns entries matching the title', async () => {
		seedEntry({
			id: 'k1',
			title: 'How to configure plugins',
			content: 'Details here',
		});
		seedEntry({
			id: 'k2',
			title: 'Database setup guide',
			content: 'Other details',
		});

		const results = await search({ kbId: TEST_KB, query: 'plugins', mode: 'keyword' });

		assert.ok(results.length >= 1, 'Should find at least one result');
		const ids = results.map((r) => r.id);
		assert.ok(ids.includes('k1'), 'Should find the entry with "plugins" in title');
	});

	it('returns entries matching content with a lower score', async () => {
		seedEntry({
			id: 'title-match',
			title: 'All about plugins',
			content: 'Not relevant',
		});
		seedEntry({
			id: 'content-match',
			title: 'Unrelated title',
			content: 'How to configure plugins properly',
		});

		const results = await search({ kbId: TEST_KB, query: 'plugins', mode: 'keyword' });

		// Both should appear
		const titleResult = results.find((r) => r.id === 'title-match');
		const contentResult = results.find((r) => r.id === 'content-match');

		assert.ok(titleResult, 'Title match should be found');
		assert.ok(contentResult, 'Content match should be found');
		assert.ok(titleResult.score > contentResult.score, 'Title match should score higher');
	});

	it('filters by tags', async () => {
		seedEntry({
			id: 'tagged',
			title: 'Plugin config',
			content: 'Details',
			tags: ['plugins'],
		});
		seedEntry({
			id: 'untagged',
			title: 'Plugin setup',
			content: 'Details',
			tags: ['unrelated'],
		});

		const results = await search({
			kbId: TEST_KB,
			query: 'Plugin',
			mode: 'keyword',
			tags: ['plugins'],
		});

		const ids = results.map((r) => r.id);
		assert.ok(ids.includes('tagged'), 'Tagged entry should be included');
		assert.ok(!ids.includes('untagged'), 'Entry without matching tag should be excluded');
	});

	it('filters out deprecated entries', async () => {
		seedEntry({
			id: 'active',
			title: 'Active plugin guide',
			content: 'Active content',
			deprecated: false,
		});
		seedEntry({
			id: 'deprecated',
			title: 'Deprecated plugin guide',
			content: 'Old content',
			deprecated: true,
		});

		const results = await search({ kbId: TEST_KB, query: 'plugin', mode: 'keyword' });

		const ids = results.map((r) => r.id);
		assert.ok(ids.includes('active'), 'Active entry should appear');
		assert.ok(!ids.includes('deprecated'), 'Deprecated entry should be filtered out');
	});

	it('logs the query to QueryLog', async () => {
		seedEntry({ id: 'q1', title: 'Logged search target', content: 'Body' });

		await search({ kbId: TEST_KB, query: 'Logged', mode: 'keyword' });

		const logs = [];
		for await (const item of tables.QueryLog.search({})) {
			logs.push(item);
		}

		assert.ok(logs.length > 0, 'Should have at least one query log entry');
		assert.strictEqual(logs[0].query, 'Logged');
	});

	it('respects the limit parameter', async () => {
		for (let i = 0; i < 10; i++) {
			seedEntry({
				id: `lim-${i}`,
				title: `Plugin entry ${i}`,
				content: 'Body',
			});
		}

		const results = await search({
			kbId: TEST_KB,
			query: 'Plugin',
			mode: 'keyword',
			limit: 3,
		});

		assert.ok(results.length <= 3, `Should return at most 3 results, got ${results.length}`);
	});
});

describe('search — hybrid mode (default)', () => {
	beforeEach(() => clearAllTables());

	it('runs without errors even if embedding model is unavailable', async () => {
		seedEntry({ id: 'h1', title: 'Hybrid search test', content: 'Content' });

		// Should not throw — semantic search gracefully fails, keyword results remain
		const results = await search({ kbId: TEST_KB, query: 'Hybrid', mode: 'hybrid' });

		assert.ok(Array.isArray(results), 'Should return an array');
	});

	it('defaults to hybrid mode when mode is not specified', async () => {
		seedEntry({
			id: 'default-mode',
			title: 'Default mode test',
			content: 'Content',
		});

		const results = await search({ kbId: TEST_KB, query: 'Default' });

		assert.ok(Array.isArray(results), 'Should return an array');
	});
});

describe('filterByApplicability', () => {
	it('boosts entries matching the caller context', () => {
		const results = [
			{
				id: 'matching',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 1.0,
				matchType: 'keyword',
				appliesTo: { tier: 'enterprise' },
			},
		];

		const filtered = filterByApplicability(results, { tier: 'enterprise' });

		assert.ok(filtered[0].score > 1.0, `Score should be boosted, got ${filtered[0].score}`);
	});

	it('demotes entries mismatching the caller context', () => {
		const results = [
			{
				id: 'mismatched',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 1.0,
				matchType: 'keyword',
				appliesTo: { region: 'eu-west' },
			},
		];

		const filtered = filterByApplicability(results, { region: 'us-east' });

		assert.ok(filtered[0].score < 1.0, `Score should be demoted, got ${filtered[0].score}`);
	});

	it('does not hide non-matching entries — only demotes', () => {
		const results = [
			{
				id: 'demoted',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 1.0,
				matchType: 'keyword',
				appliesTo: { database: 'postgres' },
			},
		];

		const filtered = filterByApplicability(results, { database: 'mysql' });

		assert.strictEqual(filtered.length, 1, 'Mismatched entry should still be in results');
		assert.ok(filtered[0].score > 0, 'Score should be positive');
	});

	it('does not adjust entries without appliesTo', () => {
		const results = [
			{
				id: 'neutral',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 0.9,
				matchType: 'keyword',
			},
		];

		const filtered = filterByApplicability(results, { tier: 'free' });

		assert.strictEqual(filtered[0].score, 0.9, 'Score should remain unchanged');
	});

	it('does not adjust when no overlapping context fields', () => {
		const results = [
			{
				id: 'no-overlap',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 0.8,
				matchType: 'keyword',
				appliesTo: { product: '4.6.0' },
			},
		];

		// Context provides region but entry specifies product — no overlap
		const filtered = filterByApplicability(results, { region: 'us-east' });

		assert.strictEqual(filtered[0].score, 0.8);
	});

	it('uses version matching for semver range values', () => {
		const results = [
			{
				id: 'version-match',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 1.0,
				matchType: 'keyword',
				appliesTo: { product: '>=2.0.0' },
			},
		];

		const boosted = filterByApplicability(results, { product: '3.1.0' });
		assert.ok(boosted[0].score > 1.0, 'Should boost for version match');

		const demoted = filterByApplicability(results, { product: '1.5.0' });
		assert.ok(demoted[0].score < 1.0, 'Should demote for version mismatch');
	});

	it('works with arbitrary custom context dimensions', () => {
		const results = [
			{
				id: 'custom',
				title: 'T',
				content: 'C',
				tags: [],
				confidence: 'verified',
				score: 1.0,
				matchType: 'keyword',
				appliesTo: { cuisine: 'italian', difficulty: 'beginner' },
			},
		];

		const filtered = filterByApplicability(results, {
			cuisine: 'italian',
			difficulty: 'beginner',
		});

		assert.ok(filtered[0].score > 1.0, 'Should boost when custom dimensions match');
	});
});
