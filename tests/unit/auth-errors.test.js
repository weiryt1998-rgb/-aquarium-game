import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorInfo, authErrorText } from '../../src/cloud/firebase.js';

const kindOf = (code) => authErrorInfo({ code }).kind;

test('รหัสผ่านผิด / บัญชีไม่ตรง → credentials (ข้อความเดิม "รหัสผ่านไม่ถูกต้อง")', () => {
  for (const code of ['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found']) {
    assert.equal(kindOf(code), 'credentials', code);
    assert.equal(authErrorText({ code }), 'รหัสผ่านไม่ถูกต้อง');
  }
});

test('ตั้งค่า Firebase ผิด → config (ไม่บอกผู้เล่นว่ารหัสผิด)', () => {
  for (const code of [
    'auth/operation-not-allowed',
    'auth/admin-restricted-operation',
    'auth/configuration-not-found',
    'auth/invalid-email',
    'auth/missing-email',
    'auth/invalid-api-key',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
    'auth/unauthorized-domain',
    'auth/requests-from-referer-are-blocked.',
  ]) {
    assert.equal(kindOf(code), 'config', code);
    assert.doesNotMatch(authErrorText({ code }), /รหัสผ่านไม่ถูกต้อง/, code);
  }
});

test('เชื่อมต่อ Firebase ไม่ได้ → network', () => {
  for (const code of ['auth/network-request-failed', 'auth/timeout', 'auth/internal-error']) assert.equal(kindOf(code), 'network', code);
});

test('ลองบ่อยเกิน / บัญชีถูกปิด / ไม่รู้จัก แยกประเภทและเก็บ code ดิบไว้แสดง', () => {
  assert.equal(kindOf('auth/too-many-requests'), 'rate-limit');
  assert.equal(kindOf('auth/user-disabled'), 'disabled');
  const unknown = authErrorInfo({ code: 'auth/something-new' });
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.code, 'auth/something-new');
  assert.equal(authErrorInfo(new Error('x')).code, 'unknown');
});
