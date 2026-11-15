import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const release='20261115c';
for(const page of ['admin.html','task.html','index.html']){
 const html=read('public/'+page);
 assert.ok(html.includes('v='+release),'HTML still references cached JS/CSS: '+page);
 assert.ok(!html.includes('v=12.3.1'),'Old cached reference remains: '+page);
}
const admin=read('public/admin.html');
const js=read('public/js/admin.js');
const api=read('cloud-functions/express/[[default]].js');
assert.ok(admin.includes('id="verifyDeployment"'),'Teacher build-check button missing');
assert.ok(admin.includes('2026-11-15 C'),'Teacher HTML has no visible release marker');
assert.ok(js.includes("RELEASE_FINGERPRINT='"+release+"'"),'Client fingerprint mismatch');
assert.ok(js.includes('verifyCurrentDeployment'),'Admin diagnostic not wired');
assert.ok(api.includes("release: '"+release+"'"),'Server fingerprint mismatch');
assert.ok(api.includes("no-store, max-age=0"),'Health must not be cached');
new vm.Script(js);
console.log('EDGEONE DEPLOY CHECK OK: HTML cache bust + backend health release + student/admin pages.');
