/**
 * Tests for OAuth metadata endpoints (RFC 9728 / RFC 8414).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';

import { handleProtectedResourceMetadata, handleAuthServerMetadata } from '../../dist/oauth/metadata.js';

function makeRequest(overrides = {}) {
	return { protocol: 'https', host: 'kb.harper.fast', ...overrides };
}

describe('handleProtectedResourceMetadata', () => {
	it('returns per-KB resource metadata', async () => {
		const response = handleProtectedResourceMetadata(makeRequest(), 'my-kb');

		assert.strictEqual(response.status, 200);
		const body = await response.json();
		assert.strictEqual(body.resource, 'https://kb.harper.fast/mcp/my-kb');
		assert.deepStrictEqual(body.authorization_servers, ['https://kb.harper.fast']);
		assert.deepStrictEqual(body.scopes_supported, ['mcp:read', 'mcp:write']);
		assert.deepStrictEqual(body.bearer_methods_supported, ['header']);
	});

	it('uses the request base URL', async () => {
		const response = handleProtectedResourceMetadata(
			makeRequest({ protocol: 'http', host: 'localhost:9926' }),
			'test-kb'
		);
		const body = await response.json();
		assert.strictEqual(body.resource, 'http://localhost:9926/mcp/test-kb');
	});

	it('sets cache headers', () => {
		const response = handleProtectedResourceMetadata(makeRequest(), 'kb1');
		assert.strictEqual(response.headers.get('Cache-Control'), 'public, max-age=3600');
		assert.strictEqual(response.headers.get('Content-Type'), 'application/json');
	});
});

describe('handleAuthServerMetadata', () => {
	it('returns authorization server metadata', async () => {
		const response = handleAuthServerMetadata(makeRequest());

		assert.strictEqual(response.status, 200);
		const body = await response.json();
		assert.strictEqual(body.issuer, 'https://kb.harper.fast');
		assert.strictEqual(body.authorization_endpoint, 'https://kb.harper.fast/mcp-auth/authorize');
		assert.strictEqual(body.token_endpoint, 'https://kb.harper.fast/mcp-auth/token');
		assert.strictEqual(body.registration_endpoint, 'https://kb.harper.fast/mcp-auth/register');
		assert.strictEqual(body.jwks_uri, 'https://kb.harper.fast/mcp-auth/jwks');
		assert.deepStrictEqual(body.response_types_supported, ['code']);
		assert.deepStrictEqual(body.grant_types_supported, ['authorization_code', 'refresh_token']);
		assert.deepStrictEqual(body.token_endpoint_auth_methods_supported, ['none']);
		assert.deepStrictEqual(body.code_challenge_methods_supported, ['S256']);
	});
});
