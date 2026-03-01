/**
 * Tests for MCP server middleware — routing and request handling.
 *
 * Each KB gets its own MCP endpoint at /mcp/<kbId>. The kbId is extracted
 * from the URL path and validated against the KnowledgeBase table.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { createMcpMiddleware } from '../../dist/mcp/server.js';

const TEST_KB = 'test-kb';

/** Seed a KnowledgeBase record so the middleware can find it. */
async function seedKb(id = TEST_KB) {
	await tables.KnowledgeBase.put({ id, name: `KB ${id}` });
}

describe('createMcpMiddleware', () => {
	beforeEach(() => clearAllTables());

	it('returns a function', () => {
		const middleware = createMcpMiddleware();

		assert.strictEqual(typeof middleware, 'function');
	});

	it('passes non-MCP paths through to next()', async () => {
		const middleware = createMcpMiddleware();
		let nextCalled = false;

		const request = { method: 'GET', pathname: '/api/other' };
		const next = async (_req) => {
			nextCalled = true;
			return { status: 200, data: 'passed through' };
		};

		const result = await middleware(request, next);

		assert.ok(nextCalled, 'next() should be called for non-MCP paths');
		assert.deepStrictEqual(result, { status: 200, data: 'passed through' });
	});

	it('passes root path through to next()', async () => {
		const middleware = createMcpMiddleware();
		let nextCalled = false;

		const request = { method: 'GET', pathname: '/' };
		const next = async () => {
			nextCalled = true;
			return 'ok';
		};

		await middleware(request, next);

		assert.ok(nextCalled);
	});

	it('passes bare /mcp path through to next()', async () => {
		const middleware = createMcpMiddleware();
		let nextCalled = false;

		const request = { method: 'POST', pathname: '/mcp' };
		const next = async () => {
			nextCalled = true;
			return 'ok';
		};

		await middleware(request, next);

		assert.ok(nextCalled, 'bare /mcp should pass through (no kbId)');
	});

	it('returns 404 for non-existent KB', async () => {
		const middleware = createMcpMiddleware();

		const request = {
			method: 'POST',
			pathname: '/mcp/no-such-kb',
			url: 'http://localhost/mcp/no-such-kb',
			headers: { 'content-type': 'application/json' },
			body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
		};

		const next = async () => 'should not reach';

		const result = await middleware(request, next);

		assert.ok(result instanceof Response);
		assert.strictEqual(result.status, 404);
		const body = await result.json();
		assert.ok(body.error.message.includes('no-such-kb'));
	});

	it('handles initialize request and returns JSON-RPC response', async () => {
		await seedKb();
		const middleware = createMcpMiddleware();
		let nextCalled = false;

		const request = {
			method: 'POST',
			pathname: `/mcp/${TEST_KB}`,
			url: `http://localhost/mcp/${TEST_KB}`,
			headers: { 'content-type': 'application/json' },
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-03-26',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0' },
				},
			},
		};

		const next = async () => {
			nextCalled = true;
			return 'should not reach here';
		};

		const result = await middleware(request, next);

		assert.ok(!nextCalled, 'next() should NOT be called for /mcp/<kbId>');
		assert.ok(result instanceof Response);
		assert.strictEqual(result.status, 200);

		const body = await result.json();
		assert.strictEqual(body.jsonrpc, '2.0');
		assert.strictEqual(body.id, 1);
		assert.ok(body.result.protocolVersion);
		assert.ok(body.result.serverInfo);
		assert.ok(body.result.capabilities.tools);
	});

	it('handles tools/list request', async () => {
		await seedKb();
		const middleware = createMcpMiddleware();

		const request = {
			method: 'POST',
			pathname: `/mcp/${TEST_KB}`,
			url: `http://localhost/mcp/${TEST_KB}`,
			headers: { 'content-type': 'application/json' },
			body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
		};

		const result = await middleware(request, async () => 'no');

		assert.ok(result instanceof Response);
		assert.strictEqual(result.status, 200);

		const body = await result.json();
		assert.strictEqual(body.jsonrpc, '2.0');
		assert.strictEqual(body.id, 2);
		assert.strictEqual(body.result.tools.length, 10);
	});

	it('returns JSON-RPC error for malformed requests', async () => {
		await seedKb();
		const middleware = createMcpMiddleware();

		const request = {
			method: 'POST',
			pathname: `/mcp/${TEST_KB}`,
			url: `http://localhost/mcp/${TEST_KB}`,
			headers: { 'content-type': 'application/json' },
			body: { not: 'a valid jsonrpc request' },
		};

		const result = await middleware(request, async () => 'no');

		assert.ok(result instanceof Response);
		assert.strictEqual(result.status, 200);

		const body = await result.json();
		assert.strictEqual(body.jsonrpc, '2.0');
		assert.strictEqual(body.error.code, -32600);
	});

	it('returns 202 for notifications', async () => {
		await seedKb();
		const middleware = createMcpMiddleware();

		const request = {
			method: 'POST',
			pathname: `/mcp/${TEST_KB}`,
			url: `http://localhost/mcp/${TEST_KB}`,
			headers: { 'content-type': 'application/json' },
			body: { jsonrpc: '2.0', method: 'notifications/initialized' },
		};

		const result = await middleware(request, async () => 'no');

		assert.ok(result instanceof Response);
		assert.strictEqual(result.status, 202);
	});
});
