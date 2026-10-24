import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { installSessionInvalidation, isSessionInvalidation } from '../src/services/authFailure.js';

function responseError(config, status, code) {
  const error = new Error('Controlled API failure');
  error.config = config;
  error.response = { status, data: { error: { code } } };
  return error;
}

test('only protected-session 401 codes invalidate identity; login failure and 503 do not', async () => {
  const version = { current: 0 };
  let invalidations = 0;
  let requests = 0;
  const cases = [
    [401, 'AUTHENTICATION_REQUIRED', true],
    [401, 'ACCOUNT_UNAVAILABLE', true],
    [401, 'INVALID_CREDENTIALS', false],
    [503, 'SESSION_STORAGE_UNAVAILABLE', false],
    [403, 'FORBIDDEN', false],
  ];
  const client = axios.create({ adapter: async (config) => {
    requests += 1;
    const [status, code] = cases[requests - 1];
    throw responseError(config, status, code);
  } });
  const remove = installSessionInvalidation(client, version, () => { invalidations += 1; });
  for (let i = 0; i < cases.length; i += 1) {
    await assert.rejects(client.get('/protected'), (error) => {
      assert.equal(isSessionInvalidation(error), cases[i][2]);
      return true;
    });
  }
  assert.equal(invalidations, 2);
  assert.equal(version.current, 2);
  assert.equal(requests, cases.length, 'the interceptor never retries a request');
  remove();
});

test('a delayed 401 from an older identity cannot clear a later login', async () => {
  const version = { current: 0 };
  let invalidations = 0;
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const client = axios.create({ adapter: (config) => {
    started();
    return new Promise((resolve, reject) => {
      release = () => reject(responseError(config, 401, 'ACCOUNT_UNAVAILABLE'));
    });
  } });
  const remove = installSessionInvalidation(client, version, () => { invalidations += 1; });
  const oldRequest = client.get('/protected');
  await entered;
  version.current += 1; // A later successful login or logout changed the identity.
  release();
  await assert.rejects(oldRequest);
  assert.equal(invalidations, 0);
  assert.equal(version.current, 1);
  remove();
});
