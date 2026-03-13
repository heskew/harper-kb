/**
 * Tests for the onAccessCheck hook.
 *
 * Verifies that the parent app can register a hook to control
 * per-KB access for MCP callers.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { registerHooks, checkAccess, getLoginPath, _resetHooks } from '../../dist/hooks.js';

const TEST_KB = 'test-kb';

const mockContext = {
	user: { id: 'test:octocat', username: 'test:octocat' },
	kbId: TEST_KB,
	resource: 'mcp',
	operation: 'read',
	channel: 'mcp',
};

describe('onAccessCheck hook', () => {
	beforeEach(() => {
		clearAllTables();
		_resetHooks();
	});

	afterEach(() => {
		_resetHooks();
	});

	it('returns null when no hook is registered (default allow)', async () => {
		const result = await checkAccess(mockContext);

		assert.strictEqual(result, null);
	});

	it('calls the registered hook with the context object', async () => {
		let receivedContext = null;

		registerHooks({
			onAccessCheck: async (context) => {
				receivedContext = context;
				return { allow: true };
			},
		});

		await checkAccess(mockContext);

		assert.deepStrictEqual(receivedContext, mockContext);
		assert.strictEqual(receivedContext.kbId, TEST_KB);
	});

	it('returns allow: true from the hook', async () => {
		registerHooks({
			onAccessCheck: async () => ({ allow: true }),
		});

		const result = await checkAccess(mockContext);

		assert.ok(result);
		assert.strictEqual(result.allow, true);
	});

	it('returns allow: false with reason', async () => {
		registerHooks({
			onAccessCheck: async () => ({
				allow: false,
				reason: 'Not a member of this KB',
			}),
		});

		const result = await checkAccess(mockContext);

		assert.ok(result);
		assert.strictEqual(result.allow, false);
		assert.strictEqual(result.reason, 'Not a member of this KB');
	});

	it('can override scopes (e.g., downgrade to read-only)', async () => {
		registerHooks({
			onAccessCheck: async () => ({
				allow: true,
				scopes: ['mcp:read'],
			}),
		});

		const result = await checkAccess(mockContext);

		assert.ok(result);
		assert.strictEqual(result.allow, true);
		assert.deepStrictEqual(result.scopes, ['mcp:read']);
	});

	it('later registerHooks calls override previous hooks', async () => {
		registerHooks({
			onAccessCheck: async () => ({ allow: false, reason: 'first' }),
		});

		registerHooks({
			onAccessCheck: async () => ({ allow: true }),
		});

		const result = await checkAccess(mockContext);

		assert.ok(result);
		assert.strictEqual(result.allow, true);
	});

	it('can make per-KB decisions', async () => {
		registerHooks({
			onAccessCheck: async (context) => {
				if (context.kbId === 'private-kb') {
					return { allow: false, reason: 'KB is private' };
				}
				return { allow: true };
			},
		});

		const publicResult = await checkAccess({ ...mockContext, kbId: 'public-kb' });
		assert.ok(publicResult);
		assert.strictEqual(publicResult.allow, true);

		const privateResult = await checkAccess({ ...mockContext, kbId: 'private-kb' });
		assert.ok(privateResult);
		assert.strictEqual(privateResult.allow, false);
	});

	it('can make per-user decisions', async () => {
		registerHooks({
			onAccessCheck: async (context) => {
				if (context.user?.id === 'test:octocat') {
					return { allow: true };
				}
				return { allow: false, reason: 'User not authorized' };
			},
		});

		const allowed = await checkAccess(mockContext);
		assert.strictEqual(allowed.allow, true);

		const denied = await checkAccess({
			...mockContext,
			user: { id: 'test:stranger', username: 'test:stranger' },
		});
		assert.strictEqual(denied.allow, false);
	});
});

describe('loginPath hook', () => {
	beforeEach(() => {
		_resetHooks();
	});

	afterEach(() => {
		_resetHooks();
	});

	it('returns null when no loginPath is registered', () => {
		assert.strictEqual(getLoginPath(), null);
	});

	it('returns the configured loginPath', () => {
		registerHooks({ loginPath: '/oauth/github/login' });
		assert.strictEqual(getLoginPath(), '/oauth/github/login');
	});

	it('loginPath can be updated by a later registerHooks call', () => {
		registerHooks({ loginPath: '/oauth/github/login' });
		registerHooks({ loginPath: '/login' });
		assert.strictEqual(getLoginPath(), '/login');
	});

	it('loginPath is independent of onAccessCheck', () => {
		registerHooks({ loginPath: '/oauth/github/login' });
		registerHooks({
			onAccessCheck: async () => ({ allow: true }),
		});

		// loginPath should still be set (merge, not replace)
		assert.strictEqual(getLoginPath(), '/oauth/github/login');
	});
});

describe('onAccessCheck integration with MCP middleware', () => {
	beforeEach(() => {
		clearAllTables();
		_resetHooks();
	});

	afterEach(() => {
		_resetHooks();
	});

	it('middleware returns 403 when hook denies access', async () => {
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });

		registerHooks({
			onAccessCheck: async () => ({
				allow: false,
				reason: 'No access to this KB',
			}),
		});

		const { createMcpMiddleware } = await import('../../dist/mcp/server.js');
		const middleware = createMcpMiddleware();

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

		const next = async () => 'should not reach';
		const result = await middleware(request, next);

		assert.ok(result instanceof Response);
		assert.strictEqual(result.status, 403);
		const body = await result.json();
		assert.strictEqual(body.error.message, 'Forbidden');
	});

	it('middleware allows access when hook returns allow: true', async () => {
		await tables.KnowledgeBase.put({ id: TEST_KB, name: 'Test KB' });

		registerHooks({
			onAccessCheck: async () => ({ allow: true }),
		});

		const { createMcpMiddleware } = await import('../../dist/mcp/server.js');
		const middleware = createMcpMiddleware();

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

		const next = async () => 'should not reach';
		const result = await middleware(request, next);

		// Should get a valid MCP response (not 403)
		assert.ok(result instanceof Response);
		assert.notStrictEqual(result.status, 403);
	});
});
