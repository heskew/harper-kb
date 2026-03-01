/**
 * Tests for OAuth JWT Bearer token validation.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { validateMcpAuth } from '../../dist/oauth/validate.js';
import { ensureSigningKey, getPrivateKey, getKeyId } from '../../dist/oauth/keys.js';

const BASE_URL = 'http://localhost:9926';
const TEST_KB = 'test-kb';

async function signTestJwt(overrides = {}) {
	const privateKey = await getPrivateKey();
	const builder = new SignJWT({
		scope: 'mcp:read mcp:write',
		client_id: 'test-client',
		...overrides,
	})
		.setProtectedHeader({ alg: 'RS256', kid: getKeyId() })
		.setSubject(overrides.sub || 'test:octocat')
		.setIssuer(overrides.iss || BASE_URL)
		.setAudience(overrides.aud || `${BASE_URL}/mcp/${TEST_KB}`)
		.setExpirationTime('1h')
		.setIssuedAt()
		.setJti(crypto.randomUUID());

	return builder.sign(privateKey);
}

function makeRequest(token, overrides = {}) {
	const headers = {};
	if (token) {
		headers.authorization = `Bearer ${token}`;
	}
	return {
		protocol: 'http',
		host: 'localhost:9926',
		headers: {
			get: (name) => headers[name.toLowerCase()] || null,
			[Symbol.iterator]: function* () {
				for (const [k, v] of Object.entries(headers)) {
					yield [k, v];
				}
			},
		},
		...overrides,
	};
}

describe('validateMcpAuth', () => {
	beforeEach(async () => {
		clearAllTables();
		await ensureSigningKey();
	});

	it('returns anonymous when no Authorization header', async () => {
		const result = await validateMcpAuth(makeRequest(null), TEST_KB);
		assert.strictEqual(result.hasToken, false);
		assert.strictEqual(result.caller, null);
	});

	it('validates a correct JWT and returns caller', async () => {
		const token = await signTestJwt();
		const result = await validateMcpAuth(makeRequest(token), TEST_KB);

		assert.strictEqual(result.hasToken, true);
		assert.ok(result.caller);
		assert.strictEqual(result.caller.userId, 'test:octocat');
		assert.strictEqual(result.caller.clientId, 'test-client');
		assert.deepStrictEqual(result.caller.scopes, ['mcp:read', 'mcp:write']);
		assert.strictEqual(result.caller.kbId, TEST_KB);
	});

	it('rejects a JWT with wrong audience (different KB)', async () => {
		const token = await signTestJwt({ aud: `${BASE_URL}/mcp/other-kb` });
		const result = await validateMcpAuth(makeRequest(token), TEST_KB);

		assert.strictEqual(result.hasToken, true);
		assert.strictEqual(result.caller, null);
	});

	it('rejects a JWT with wrong issuer', async () => {
		const token = await signTestJwt({ iss: 'https://evil.com' });
		const result = await validateMcpAuth(makeRequest(token), TEST_KB);

		assert.strictEqual(result.hasToken, true);
		assert.strictEqual(result.caller, null);
	});

	it('rejects a malformed token', async () => {
		const result = await validateMcpAuth(makeRequest('not.a.valid.jwt'), TEST_KB);

		assert.strictEqual(result.hasToken, true);
		assert.strictEqual(result.caller, null);
	});

	it('ignores non-Bearer authorization headers', async () => {
		const request = makeRequest(null);
		// Override with Basic auth
		request.headers = {
			get: (name) => (name.toLowerCase() === 'authorization' ? 'Basic dXNlcjpwYXNz' : null),
			[Symbol.iterator]: function* () {
				yield ['authorization', 'Basic dXNlcjpwYXNz'];
			},
		};

		const result = await validateMcpAuth(request, TEST_KB);
		assert.strictEqual(result.hasToken, false);
		assert.strictEqual(result.caller, null);
	});

	it('parses read-only scope', async () => {
		const token = await signTestJwt({ scope: 'mcp:read' });
		const result = await validateMcpAuth(makeRequest(token), TEST_KB);

		assert.ok(result.caller);
		assert.deepStrictEqual(result.caller.scopes, ['mcp:read']);
	});
});
