import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('CmdbLabels launcher auto-opens from CMDBuild custom page hash', () => {
  const source = fs.readFileSync('src/CmdbLabels.js', 'utf8');

  assert.match(source, /custompages\/CmdbLabels/);
  assert.match(source, /return '\/cmdbuild\/labels\/ui'/);
  assert.match(source, /href="\/cmdbuild\/labels\/ui"/);
  assert.equal(source.includes(['cmdbLabels', 'EscapeHtml'].join('')), false);
  assert.doesNotMatch(source, /location\.port === '8090'/);
  assert.match(source, /cmdbLabelsShouldAutoOpen/);
  assert.match(source, /cmdbLabelsLauncherState/);
  assert.match(source, /state\.redirecting/);
  assert.match(source, /redirect-skip/);
  assert.match(source, /initComponent-redirect/);
  assert.match(source, /afterrender-redirect/);
  assert.match(source, /cmdbLabelsScheduleRedirect\('initComponent-redirect'\)/);
  assert.match(source, /cmdbLabelsScheduleRedirect\('afterrender-redirect'\)/);
  assert.match(source, /cmdbLabelsClientLog\('launcher-redirect',\s*target\)/);
  assert.match(source, /Ext\.define\('CMDBuildUI\.view\.custompages\.CmdbLabels\.CmdbLabels'/);
});
