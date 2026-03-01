/**
 * Tests for OAuth authorization endpoint.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { handleAuthorizeGet, handleAuthorizePost } from '../../dist/oauth/authorize.js';
import { registerHooks, _resetHooks } from '../../dist/hooks.js';

const TEST_CLIENT_ID = 'client-1';
const VALID_PARAMS =
	`client_id=${TEST_CLIENT_ID}` +
	`&redirect_uri=${encodeURIComponent('http://localhost:3000/callback')}` +
	'&response_type=code' +
	'&state=random-state' +
	'&code_challenge=test-challenge-abc' +
	'&code_challenge_method=S256' +
	'&scope=mcp%3Aread%20mcp%3Awrite';

async function registerClient() {
	await databases.kb.OAuthClient.put({
		id: TEST_CLIENT_ID,
		clientName: 'Test MCP Client',
		redirectUris: ['http://localhost:3000/callback'],
		grantTypes: ['authorization_code'],
		responseTypes: ['code'],
		scope: 'mcp:read mcp:write',
	});
}

function makeGetRequest(queryString, session = null) {
	return {
		url: `http://localhost:9926/mcp-auth/authorize?${queryString}`,
		pathname: '/mcp-auth/authorize',
		method: 'GET',
		host: 'localhost:9926',
		protocol: 'http',
		session,
		headers: { get: () => null },
	};
}

function makePostRequest(formBody, { login } = {}) {
	return {
		pathname: '/mcp-auth/authorize',
		method: 'POST',
		host: 'localhost:9926',
		protocol: 'http',
		body: formBody,
		session: null,
		login: login || (() => Promise.reject(new Error('Invalid credentials'))),
		headers: {
			get: (name) => (name === 'content-type' ? 'application/x-www-form-urlencoded' : null),
		},
	};
}

describe('handleAuthorizeGet', () => {
	beforeEach(async () => {
		clearAllTables();
		_resetHooks();
	});

	afterEach(() => {
		_resetHooks();
	});

	it('returns error page when client_id is missing', async () => {
		const response = await handleAuthorizeGet(makeGetRequest('redirect_uri=http://localhost&response_type=code'));
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('client_id'));
	});

	it("returns error page when response_type is not 'code'", async () => {
		await registerClient();
		const response = await handleAuthorizeGet(
			makeGetRequest(VALID_PARAMS.replace('response_type=code', 'response_type=token'))
		);
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('response_type'));
	});

	it('returns error page when state is missing', async () => {
		await registerClient();
		const qs = VALID_PARAMS.replace('&state=random-state', '');
		const response = await handleAuthorizeGet(makeGetRequest(qs));
		assert.strictEqual(response.status, 400);
	});

	it('returns error page when code_challenge is missing', async () => {
		await registerClient();
		const qs = VALID_PARAMS.replace('&code_challenge=test-challenge-abc', '');
		const response = await handleAuthorizeGet(makeGetRequest(qs));
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('PKCE'));
	});

	it('returns error page when code_challenge_method is not S256', async () => {
		await registerClient();
		const qs = VALID_PARAMS.replace('code_challenge_method=S256', 'code_challenge_method=plain');
		const response = await handleAuthorizeGet(makeGetRequest(qs));
		assert.strictEqual(response.status, 400);
	});

	it('returns error page when client_id is unknown', async () => {
		// Don't register client
		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS));
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('Unknown client_id'));
	});

	it("returns error page when redirect_uri doesn't match registration", async () => {
		await registerClient();
		const qs = VALID_PARAMS.replace(
			encodeURIComponent('http://localhost:3000/callback'),
			encodeURIComponent('http://localhost:9999/evil')
		);
		const response = await handleAuthorizeGet(makeGetRequest(qs));
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('redirect_uri'));
	});

	it('shows credential-only login page when no loginPath is set', async () => {
		await registerClient();
		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS));

		assert.strictEqual(response.status, 200);
		const html = await response.text();
		// No SSO button element (CSS class may still be in stylesheet)
		assert.ok(!html.includes('class="sso-btn"'));
		// Credential form is visible by default
		assert.ok(html.includes('class="cred-form visible"'));
		assert.ok(html.includes('Test MCP Client'));
	});

	it('shows SSO button when loginPath is configured', async () => {
		await registerClient();
		registerHooks({ loginPath: '/oauth/github/login' });

		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS));

		assert.strictEqual(response.status, 200);
		const html = await response.text();
		assert.ok(html.includes('class="sso-btn"'));
		assert.ok(html.includes('Sign in'));
		assert.ok(html.includes('/oauth/github/login'));
	});

	it('shows login page with security headers', async () => {
		await registerClient();
		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS));

		assert.strictEqual(response.headers.get('X-Frame-Options'), 'DENY');
		assert.strictEqual(response.headers.get('X-Content-Type-Options'), 'nosniff');
		assert.strictEqual(response.headers.get('Referrer-Policy'), 'no-referrer');
	});

	it('issues auth code directly when user has active OAuth session', async () => {
		await registerClient();

		const session = {
			user: 'user-1',
			oauthUser: { username: 'octocat', provider: 'github' },
		};

		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS, session));

		assert.strictEqual(response.status, 302);
		const location = response.headers.get('Location');
		assert.ok(location.startsWith('http://localhost:3000/callback'));
		assert.ok(location.includes('code='));
		assert.ok(location.includes('state=random-state'));
	});

	it('stores auth code with provider prefix from session', async () => {
		await registerClient();

		const session = {
			user: 'user-1',
			oauthUser: { username: 'jdoe', provider: 'google' },
		};

		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS, session));

		assert.strictEqual(response.status, 302);
		const location = response.headers.get('Location');
		const codeParam = new URL(location).searchParams.get('code');

		const stored = await databases.kb.OAuthCode.get(codeParam);
		assert.ok(stored);
		assert.strictEqual(stored.userId, 'google:jdoe');
		assert.strictEqual(stored.type, 'code');
	});

	it('completes authorization when returning from OAuth login', async () => {
		await registerClient();
		registerHooks({ loginPath: '/oauth/github/login' });

		// Stash a pending record
		await databases.kb.OAuthCode.put({
			id: 'pending-123',
			clientId: TEST_CLIENT_ID,
			userId: 'client-state',
			scope: 'mcp:read mcp:write',
			codeChallenge: 'challenge',
			codeChallengeMethod: 'S256',
			redirectUri: 'http://localhost:3000/callback',
			type: 'pending',
		});

		const session = {
			user: 'user-1',
			oauthUser: { username: 'octocat', provider: 'github' },
		};

		const response = await handleAuthorizeGet(makeGetRequest('pending=pending-123', session));

		assert.strictEqual(response.status, 302);
		const location = response.headers.get('Location');
		assert.ok(location.includes('code='));

		// Pending record should be deleted
		const pending = await databases.kb.OAuthCode.get('pending-123');
		assert.strictEqual(pending, null);
	});

	it('returns error when completing without session', async () => {
		const response = await handleAuthorizeGet(makeGetRequest('pending=pending-123'));
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('Authentication required'));
	});

	it('returns error when pending record is expired/missing', async () => {
		const session = {
			user: 'user-1',
			oauthUser: { username: 'octocat', provider: 'github' },
		};
		const response = await handleAuthorizeGet(makeGetRequest('pending=nonexistent', session));
		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('expired'));
	});

	it("uses 'oauth' as default provider prefix when oauthUser has no provider", async () => {
		await registerClient();

		const session = {
			user: 'user-1',
			oauthUser: { username: 'someone' },
		};

		const response = await handleAuthorizeGet(makeGetRequest(VALID_PARAMS, session));

		assert.strictEqual(response.status, 302);
		const location = response.headers.get('Location');
		const codeParam = new URL(location).searchParams.get('code');

		const stored = await databases.kb.OAuthCode.get(codeParam);
		assert.strictEqual(stored.userId, 'oauth:someone');
	});
});

describe('handleAuthorizePost', () => {
	beforeEach(async () => {
		clearAllTables();
		_resetHooks();
		await registerClient();
	});

	afterEach(() => {
		_resetHooks();
	});

	it('validates Harper credentials and issues auth code', async () => {
		const formBody = new URLSearchParams({
			username: 'admin',
			password: 'secret',
			client_id: TEST_CLIENT_ID,
			redirect_uri: 'http://localhost:3000/callback',
			response_type: 'code',
			state: 'my-state',
			code_challenge: 'test-challenge',
			code_challenge_method: 'S256',
			scope: 'mcp:read mcp:write',
		}).toString();

		const login = () => Promise.resolve();
		const response = await handleAuthorizePost(makePostRequest(formBody, { login }));

		assert.strictEqual(response.status, 302);
		const location = response.headers.get('Location');
		assert.ok(location.includes('code='));
		assert.ok(location.includes('state=my-state'));
	});

	it('returns error when credentials are invalid', async () => {
		const formBody = new URLSearchParams({
			username: 'admin',
			password: 'wrong',
			client_id: TEST_CLIENT_ID,
			redirect_uri: 'http://localhost:3000/callback',
			response_type: 'code',
			state: 'my-state',
			code_challenge: 'test-challenge',
			code_challenge_method: 'S256',
		}).toString();

		const login = () => Promise.reject(new Error('Invalid credentials'));
		const response = await handleAuthorizePost(makePostRequest(formBody, { login }));

		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('Invalid username or password'));
	});

	it('returns error when username or password is missing', async () => {
		const formBody = new URLSearchParams({
			client_id: TEST_CLIENT_ID,
			redirect_uri: 'http://localhost:3000/callback',
			response_type: 'code',
			state: 'my-state',
			code_challenge: 'test-challenge',
			code_challenge_method: 'S256',
		}).toString();

		const response = await handleAuthorizePost(makePostRequest(formBody));

		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('required'));
	});

	it('re-validates OAuth params on POST', async () => {
		const formBody = new URLSearchParams({
			username: 'admin',
			password: 'secret',
			client_id: 'nonexistent-client',
			redirect_uri: 'http://localhost:3000/callback',
			response_type: 'code',
			state: 'my-state',
			code_challenge: 'test-challenge',
			code_challenge_method: 'S256',
		}).toString();

		const response = await handleAuthorizePost(makePostRequest(formBody));

		assert.strictEqual(response.status, 400);
		const html = await response.text();
		assert.ok(html.includes('Unknown client_id'));
	});

	it('stores auth code with harper: prefix for credential login', async () => {
		const formBody = new URLSearchParams({
			username: 'admin',
			password: 'secret',
			client_id: TEST_CLIENT_ID,
			redirect_uri: 'http://localhost:3000/callback',
			response_type: 'code',
			state: 'my-state',
			code_challenge: 'test-challenge',
			code_challenge_method: 'S256',
		}).toString();

		const login = () => Promise.resolve();
		const response = await handleAuthorizePost(makePostRequest(formBody, { login }));
		const location = response.headers.get('Location');
		const codeParam = new URL(location).searchParams.get('code');

		const stored = await databases.kb.OAuthCode.get(codeParam);
		assert.ok(stored);
		assert.strictEqual(stored.userId, 'harper:admin');
		assert.strictEqual(stored.type, 'code');
	});
});
