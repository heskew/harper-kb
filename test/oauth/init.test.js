/**
 * Tests for OAuth initialization.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { initOAuth } from '../../dist/oauth/init.js';

describe('initOAuth', () => {
	beforeEach(() => clearAllTables());

	it('initializes without errors', async () => {
		let httpRegistered = false;
		const scope = {
			logger: {
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {},
			},
			server: {
				http: (middleware) => {
					httpRegistered = true;
					assert.strictEqual(typeof middleware, 'function');
				},
			},
		};

		await initOAuth(scope);

		// Should have registered HTTP middleware
		assert.ok(httpRegistered, 'OAuth middleware should be registered');

		// Should have created a signing key
		const key = await databases.kb.OAuthSigningKey.get('primary');
		assert.ok(key, 'Signing key should be stored');
	});

	it('handles signing key initialization failure gracefully', async () => {
		let _errorLogged = false;
		const scope = {
			logger: {
				info: () => {},
				warn: () => {},
				error: () => {
					_errorLogged = true;
				},
				debug: () => {},
			},
			server: {
				http: () => {},
			},
		};

		// Break the OAuthSigningKey table to simulate failure
		const originalPut = databases.kb.OAuthSigningKey.put;
		const originalGet = databases.kb.OAuthSigningKey.get;
		databases.kb.OAuthSigningKey.put = async () => {
			throw new Error('DB write failed');
		};
		databases.kb.OAuthSigningKey.get = async () => null;

		// initOAuth catches the error and logs it — should not throw
		await initOAuth(scope);

		databases.kb.OAuthSigningKey.put = originalPut;
		databases.kb.OAuthSigningKey.get = originalGet;
	});
});
