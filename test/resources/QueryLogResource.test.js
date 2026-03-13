/**
 * Tests for QueryLogResource — REST endpoint for search query analytics.
 *
 * All operations require team role.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { QueryLogResource } from '../../dist/resources/QueryLogResource.js';

const TEST_KB = 'test-kb';

describe('QueryLogResource', () => {
	beforeEach(() => clearAllTables());

	describe('GET', () => {
		it('requires authentication', async () => {
			const resource = new QueryLogResource();
			resource._setContext({ user: null });

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 401);
		});

		it('requires team role', async () => {
			const resource = new QueryLogResource();
			resource._setContext({ user: { id: 'u1', role: 'service_account' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 403);
		});

		it('returns query logs for team users', async () => {
			await tables.QueryLog.put({
				id: 'log-1',
				kbId: TEST_KB,
				query: 'plugin config',
				resultCount: 5,
			});
			await tables.QueryLog.put({
				id: 'log-2',
				kbId: TEST_KB,
				query: 'auth setup',
				resultCount: 2,
			});

			const resource = new QueryLogResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });

			const result = await resource.get({ kbId: TEST_KB });

			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 2);
		});

		it('returns a single log entry by ID', async () => {
			await tables.QueryLog.put({
				id: 'single-log',
				kbId: TEST_KB,
				query: 'specific search',
				resultCount: 1,
			});

			const resource = new QueryLogResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('single-log');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.id, 'single-log');
			assert.strictEqual(result.query, 'specific search');
		});

		it('returns 404 for non-existent log entry', async () => {
			const resource = new QueryLogResource();
			resource._setContext({ user: { id: 'admin', role: 'team' } });
			resource._setId('missing-log');

			const result = await resource.get({ kbId: TEST_KB });

			assert.strictEqual(result.status, 404);
		});
	});
});
