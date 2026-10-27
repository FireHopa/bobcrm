import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
function load(relativePath) {
  const file = path.resolve(root, relativePath);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(file), specifier);
    const target = [base, `${base}.ts`, `${base}.tsx`].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!target) throw new Error(`Cannot resolve ${specifier} from ${file}`);
    return load(target);
  };
  vm.runInThisContext(`(function(require,module,exports){${result.outputText}\n})`, { filename: file })(localRequire, module, module.exports);
  return module.exports;
}
// Browser storage is only needed by the API module's legacy-session cleanup.
globalThis.localStorage = { removeItem() {}, getItem() { return null; }, setItem() {} };
globalThis.sessionStorage = { removeItem() {}, getItem() { return null; }, setItem() {} };
const { normalizeLeadFromApi } = load('src/utils/api.ts');
const { createLeadDrawerFormState } = load('src/features/leads/leadDrawerModel.ts');
const { buildLeadDrawerPatch, rebaseLeadDraft } = load('src/features/leads/leadEditing.ts');
const base = normalizeLeadFromApi({ id: 'lead-1', name: 'Original', observation: 'Stored observation', pain: 'Stored pain', commercialNotes: 'Stored legacy note', serviceStatusMap: {}, serviceInterests: [], createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z' });

test('consultant payload contains only intentionally edited permitted fields', () => {
  const draft = { ...createLeadDrawerFormState(base), name: ' Edited ', observation: 'Blocked' };
  assert.deepEqual(buildLeadDrawerPatch(base, draft, false).changes, { name: 'Edited' });
});
test('normalization-generated defaults do not generate changes for either role', () => {
  for (const full of [true, false]) assert.deepEqual(buildLeadDrawerPatch(base, createLeadDrawerFormState(base), full).changes, {});
});
test('full editors do not resend unedited notes, service defaults or immutable fields', () => {
  const draft = { ...createLeadDrawerFormState(base), name: 'Edited' };
  const payload = buildLeadDrawerPatch(base, draft, true);
  assert.deepEqual(payload.changes, { name: 'Edited' });
  assert.equal(payload.expectedUpdatedAt, base.updatedAt);
});
test('explicit clearing remains distinguishable from omission', () => {
  const draft = { ...createLeadDrawerFormState(base), observation: '' };
  assert.deepEqual(buildLeadDrawerPatch(base, draft, true).changes, { observation: '' });
});
test('late temperature response keeps text typed while the request was pending', () => {
  const draft = { ...createLeadDrawerFormState(base), name: 'Typed while saving', temperature: 'Quente' };
  const incoming = { ...base, temperature: 'Quente', updatedAt: '2026-10-14T10:01:00.000Z' };
  const rebased = rebaseLeadDraft(draft, base, incoming);
  assert.deepEqual(rebased.conflicts, []);
  assert.equal(rebased.draft.name, draft.name);
  assert.deepEqual(buildLeadDrawerPatch(incoming, rebased.draft, false).changes, { name: draft.name });
});
test('unrelated server refresh is rebased without overwriting the local edit', () => {
  const draft = { ...createLeadDrawerFormState(base), name: 'Local' };
  const incoming = { ...base, observation: 'New server observation' };
  const rebased = rebaseLeadDraft(draft, base, incoming);
  assert.deepEqual(rebased.conflicts, []);
  assert.equal(rebased.draft.name, 'Local');
  assert.equal(rebased.draft.observation, incoming.observation);
});
test('same-field concurrent changes are flagged and local data is preserved', () => {
  const draft = { ...createLeadDrawerFormState(base), name: 'Local' };
  const rebased = rebaseLeadDraft(draft, base, { ...base, name: 'Remote' });
  assert.deepEqual(rebased.conflicts, ['name']);
  assert.equal(rebased.draft.name, 'Local');
});
test('nested custom fields rebase independently instead of replacing the whole map', () => {
  const draft = createLeadDrawerFormState(base);
  draft.customFields['Indicado por'] = 'Local';
  const incoming = { ...base, customFields: { ...base.customFields, 'Datas Imers\u00e3o': '14/10/2026' } };
  const rebased = rebaseLeadDraft(draft, base, incoming);
  assert.deepEqual(rebased.conflicts, []);
  assert.equal(rebased.draft.customFields['Indicado por'], 'Local');
  assert.equal(rebased.draft.customFields['Datas Imers\u00e3o'], '14/10/2026');
  assert.deepEqual(buildLeadDrawerPatch(incoming, rebased.draft, true).changes, { customFields: { 'Indicado por': 'Local' } });
});
test('App keeps full detail separate from list and does not reload after a failed edit', () => {
  const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(source, /\[selectedLead, setSelectedLead\] = useState<Lead \| null>/);
  assert.doesNotMatch(source, /leads\.find\(.*selectedLeadId/);
  const edit = source.slice(source.indexOf('  const updateLead ='), source.indexOf('  const updateLeadSilently'));
  assert.doesNotMatch(edit, /loadLeadsFromServer/);
  assert.match(edit, /throw caughtError/);
  assert.ok(edit.indexOf('await patchLeadOnServer') < edit.indexOf('replaceLeadInState(savedLead)'));
});
