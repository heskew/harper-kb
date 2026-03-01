/**
 * Tests for OAuth middleware routing.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { createOAuthMiddleware } from '../../dist/oauth/middleware.js';
import { ensureSigningKey } from '../../dist/oauth/keys.js';

describe('createOAuthMiddleware', () => {
	let middleware;
	let fetchMock;

	beforeEach(async () => {
		clearAllTables();
		await ensureSigningKey();
		middleware = createOAuthMiddleware();
		fetchMock = mock.method(globalThis, 'fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
	});

	afterEach(() => {
		fetchMock.mock.restore();
	});

	it('returns a function', () => {
		assert.strictEqual(typeof middleware, 'function');
	});

	it('passes non-OAuth paths through to next()', async () => {
		let nextCalled = false;
		const request = { pathname: '/Knowledge/123', method: 'GET' };
		await middleware(request, async () => {
			nextCalled = true;
		});
		assert.ok(nextCalled);
	});

	it('passes root path through to next()', async () => {
		let nextCalled = false;
		await middleware({ pathname: '/', method: 'GET' }, async () => {
			nextCalled = true;
		});
		assert.ok(nextCalled);
	});

	it('routes GET /.well-known/oauth-authorization-server to metadata', async () => {
		const request = {
			pathname: '/.well-known/oauth-authorization-server',
			method: 'GET',
			protocol: 'http',
			host: 'localhost:9926',
		};

		const response = await middleware(request, async () => {
			throw new Error('next() should not be called');
		});

		assert.strictEqual(response.status, 200);
		const body = JSON.parse(await response.text());
		assert.ok(body.issuer);
		assert.ok(body.authorization_endpoint);
		assert.ok(body.token_endpoint);
	});

	it('routes GET /.well-known/oauth-protected-resource/<kbId> to per-KB metadata', async () => {
		const request = {
			pathname: '/.well-known/oauth-protected-resource/my-kb',
			method: 'GET',
			protocol: 'http',
			host: 'localhost:9926',
		};

		const response = await middleware(request, async () => {
			throw new Error('next() should not be called');
		});

		assert.strictEqual(response.status, 200);
		const body = JSON.parse(await response.text());
		assert.strictEqual(body.resource, 'http://localhost:9926/mcp/my-kb');
	});

	it('routes POST /mcp-auth/register to DCR', async () => {
		const request = {
			pathname: '/mcp-auth/register',
			method: 'POST',
			body: JSON.stringify({
				client_name: 'Test',
				redirect_uris: ['http://localhost:3000/callback'],
			}),
			headers: {
				get: (name) => (name === 'content-type' ? 'application/json' : null),
			},
		};

		const response = await middleware(request, async () => {
			throw new Error('next() should not be called');
		});

		assert.strictEqual(response.status, 201);
		const body = JSON.parse(await response.text());
		assert.ok(body.client_id);
	});

	it('routes POST /mcp-auth/token to token endpoint', async () => {
		const request = {
			pathname: '/mcp-auth/token',
			method: 'POST',
			body: 'grant_type=invalid',
			protocol: 'http',
			host: 'localhost:9926',
			headers: {
				get: (name) => (name === 'content-type' ? 'application/x-www-form-urlencoded' : null),
			},
		};

		const response = await middleware(request, async () => {
			throw new Error('next() should not be called');
		});

		// Will return error for invalid grant_type — but proves routing works
		assert.strictEqual(response.status, 400);
		const body = JSON.parse(await response.text());
		assert.strictEqual(body.error, 'unsupported_grant_type');
	});

	it('routes GET /mcp-auth/jwks to public key set', async () => {
		const request = {
			pathname: '/mcp-auth/jwks',
			method: 'GET',
		};

		const response = await middleware(request, async () => {
			throw new Error('next() should not be called');
		});

		assert.strictEqual(response.status, 200);
		const body = JSON.parse(await response.text());
		assert.ok(body.keys);
		assert.ok(body.keys.length > 0);
		assert.strictEqual(body.keys[0].alg, 'RS256');
	});

	it('routes GET /mcp-auth/authorize to login page', async () => {
		await databases.kb.OAuthClient.put({
			id: 'client-1',
			clientName: 'Test',
			redirectUris: ['http://localhost:3000/callback'],
		});

		const request = {
			pathname: '/mcp-auth/authorize',
			method: 'GET',
			url: 'http://localhost:9926/mcp-auth/authorize?client_id=client-1&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&response_type=code&state=s&code_challenge=c&code_challenge_method=S256',
			host: 'localhost:9926',
			protocol: 'http',
			headers: { get: () => null },
		};

		const response = await middleware(request, async () => {
			throw new Error('next() should not be called');
		});

		assert.strictEqual(response.status, 200);
		const html = await response.text();
		assert.ok(html.includes('Authorize'));
	});

	it('does not route POST to /.well-known paths', async () => {
		let nextCalled = false;
		const request = {
			pathname: '/.well-known/oauth-authorization-server',
			method: 'POST',
		};
		await middleware(request, async () => {
			nextCalled = true;
		});
		assert.ok(nextCalled);
	});
});
