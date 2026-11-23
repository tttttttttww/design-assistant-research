import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {INTERVENTION_ORIENTATION, getSessionConfig, SCHEMA_VERSION} from '../src/config/researchConfig.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
assert.equal(SCHEMA_VERSION,25);
assert.equal(getSessionConfig('W8').task_flow.min_ai_exchanges_total,3);
for(const id of ['W8','W9','W10']) {
 const o=INTERVENTION_ORIENTATION[id].supported;
 assert.equal(o.checks.length,1);
 assert.equal(o.practice_reason_required,true);
 assert.equal(o.checks[0].options.length,3);
 assert(o.checks[0].options.every(x=>x.length>=27),`${id}: distractors too simplistic`);
 assert(!o.checks[0].options.some(x=>/相信AI|删掉|随便|直接要完整|肯定/.test(x)),`${id}: obvious distractor retained`);
 assert.equal(INTERVENTION_ORIENTATION[id].control.practice_reason_required,undefined);
}
assert(read('public/js/task.js').includes('answers.practice_reason'));
assert(read('src/services/researchService.js').includes('clean.practice_reason'));
const page=read('public/task.html'),rec=read('public/js/optional-screen-recording.js');
assert(page.includes('screenRecordingConsent')&&page.includes('optional-screen-recording.js'));
assert(rec.includes('getDisplayMedia')&&rec.includes('displaySurface')&&rec.includes("surface!=='browser'"));
assert(rec.includes('window.isSecureContext')&&rec.includes('download.addEventListener'));
assert(!rec.includes('session/event')&&!rec.includes('fetch('),'Video data must not be sent to research backend');
console.log('v12.4.8 PRACTICE + OPTIONAL PRIVACY-SAFE RECORDER TEST OK');
