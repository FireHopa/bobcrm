import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLead, leadToDbParams } from './leadMapper.js';
import { prepareLeadPatch } from './leadPatch.js';
import { assertLeadFieldUpdateAllowed, getChangedLeadFields } from '../../rolePolicy.js';

const fields = ['name', 'email', 'phone', 'company', 'website', 'instagram', 'temperature', 'expectedCloseAt', 'observation', 'commercialNotes', 'pain', 'serviceStatusMap', 'serviceInterests', 'customFields', 'responsibleUserId', 'pipelineId', 'pipelineStageId'];
const before = normalizeLead({
  id: 'lead-regression', name: 'Original', email: 'test@example.test', observation: 'Saved observation',
  commercialNotes: 'Saved legacy note', pain: 'Saved pain', serviceStatusMap: {}, serviceInterests: [],
  customFields: { 'Indicado por': 'Event' }, responsibleUserId: 'owner-1',
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z',
});
const patch = (changes, expectedUpdatedAt = before.updatedAt) => prepareLeadPatch(before, { changes, expectedUpdatedAt }, fields);

test('partial name update preserves all omitted cold/detail fields through DB mapping', () => {
  const result = patch({ name: 'Edited' });
  for (const key of ['observation', 'commercialNotes', 'pain', 'serviceStatusMap', 'serviceInterests', 'customFields', 'createdAt', 'responsibleUserId']) {
    assert.deepEqual(result[key], before[key], key);
  }
  assert.equal(result.name, 'Edited');
  const params = leadToDbParams(result, { updatedAt: '2026-10-14T11:00:00.000Z' });
  for (const value of ['Saved observation', 'Saved legacy note', 'Saved pain']) assert.ok(params.includes(value), value);
});

test('consultant changing only name is not rejected due to service defaults', () => {
  const result = patch({ name: 'Edited' });
  const changed = getChangedLeadFields(before, result, fields);
  assert.deepEqual(changed, ['name']);
  assert.doesNotThrow(() => assertLeadFieldUpdateAllowed({ role: 'consultor_vendas' }, changed));
});

test('consultant permissions remain enforced for forbidden changes', () => {
  const changed = getChangedLeadFields(before, patch({ observation: 'Forbidden' }), fields);
  assert.throws(() => assertLeadFieldUpdateAllowed({ role: 'consultor_vendas' }, changed), { statusCode: 403 });
  assert.doesNotThrow(() => assertLeadFieldUpdateAllowed({ role: 'admin' }, changed));
  assert.doesNotThrow(() => assertLeadFieldUpdateAllowed({ role: 'pre_venda' }, changed));
});

test('explicit empty string still clears a permitted field', () => {
  assert.equal(patch({ observation: '' }).observation, '');
  assert.equal(patch({ observation: '' }).commercialNotes, before.commercialNotes);
});

test('partial nested maps preserve unrelated saved keys', () => {
  const source = { ...before, serviceStatusMap: { Google: 'Casa do Ads', Meta: 'Outra agencia' }, customFields: { 'Indicado por': 'Event', 'Datas Imers\u00e3o': '14/10/2026' } };
  const result = prepareLeadPatch(source, { expectedUpdatedAt: source.updatedAt, changes: { serviceStatusMap: { Google: 'Nao sabemos' }, customFields: { 'Indicado por': 'Referral' } } }, fields);
  assert.equal(result.serviceStatusMap.Meta, 'Outra agencia');
  assert.equal(result.customFields['Datas Imers\u00e3o'], '14/10/2026');
});

test('missing and stale edit versions are rejected without disabling concurrency protection', () => {
  assert.throws(() => prepareLeadPatch(before, { changes: { name: 'Edited' } }, fields), { statusCode: 400 });
  assert.throws(() => patch({ name: 'Edited' }, '2026-10-14T09:00:00.000Z'), { statusCode: 409, code: 'STALE_WRITE_CONFLICT' });
});

for (const key of ['id', 'createdAt', 'deletedAt', 'sdrResponsibleUserId', 'pipelineId', 'pipelineStageId', '__proto__']) {
  test(`PATCH refuses protected or unknown field ${key}`, () => {
    assert.throws(() => patch(JSON.parse(`{"${key}": "tampered"}`)), { statusCode: 400 });
  });
}

test('invalid nested objects do not erase data', () => {
  for (const value of [null, [], '']) assert.throws(() => patch({ customFields: value }), { statusCode: 400 });
  assert.throws(() => patch({ name: null }), { statusCode: 400 });
  assert.throws(() => patch({ customFields: JSON.parse('{"__proto__":{"polluted":true}}') }), { statusCode: 400 });
  assert.equal({}.polluted, undefined);
});
