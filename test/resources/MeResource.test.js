/**
 * Tests for MeResource — current user session info.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';

import { MeResource } from '../../dist/resources/MeResource.js';

describe('MeResource', () => {
	it('returns authenticated: false when no session', () => {
		const resource = new MeResource();
		const result = resource.get();
		assert.deepStrictEqual(result, { authenticated: false });
	});

	it('returns OAuth user info from session', () => {
		const resource = new MeResource();
		resource._setContext({
			session: {
				oauthUser: {
					username: 'octocat',
					name: 'The Octocat',
					provider: 'github',
				},
			},
		});

		const result = resource.get();

		assert.strictEqual(result.authenticated, true);
		assert.strictEqual(result.username, 'octocat');
		assert.strictEqual(result.name, 'The Octocat');
		assert.strictEqual(result.provider, 'github');
	});

	it('returns Harper user info (string user)', () => {
		const resource = new MeResource();
		resource._setContext({ user: 'admin' });

		const result = resource.get();

		assert.strictEqual(result.authenticated, true);
		assert.strictEqual(result.username, 'admin');
		assert.strictEqual(result.provider, 'harper');
	});

	it('returns Harper user info (object user with username)', () => {
		const resource = new MeResource();
		resource._setContext({ user: { username: 'admin', role: 'admin' } });

		const result = resource.get();

		assert.strictEqual(result.authenticated, true);
		assert.strictEqual(result.username, 'admin');
		assert.strictEqual(result.provider, 'harper');
	});

	it('returns Harper user info (object user with id only)', () => {
		const resource = new MeResource();
		resource._setContext({ user: { id: 'user-123' } });

		const result = resource.get();

		assert.strictEqual(result.authenticated, true);
		assert.strictEqual(result.username, 'user-123');
		assert.strictEqual(result.provider, 'harper');
	});

	it('prefers OAuth session over Harper user', () => {
		const resource = new MeResource();
		resource._setContext({
			user: 'admin',
			session: {
				oauthUser: {
					username: 'octocat',
					name: 'The Octocat',
					provider: 'github',
				},
			},
		});

		const result = resource.get();

		assert.strictEqual(result.username, 'octocat');
		assert.strictEqual(result.provider, 'github');
	});
});
