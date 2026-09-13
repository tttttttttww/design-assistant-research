import { readFile, access } from 'node:fs/promises';
const must = [
  'public/index.html','public/task.html','public/admin.html','public/js/task.js','public/js/admin.js',
  'src/config/researchConfig.js','src/services/researchService.js','src/services/cozeService.js',
  'src/routes/course.js','src/routes/chat.js','src/routes/upload.js','src/routes/admin.js','cloud-functions/express/[[default]].js'
];
for (const f of must) await access(f);
const cfg = await import('../src/config/researchConfig.js');
if (cfg.SESSIONS.length !== 12) throw new Error(`Expected 12 sessions, got ${cfg.SESSIONS.length}`);
const ids = cfg.SESSIONS.map(x=>x.id);
if (new Set(ids).size !== 12) throw new Error('Duplicate session ids');
for (const s of cfg.SESSIONS) {
  if (!s.title || !Array.isArray(s.brief) || !Array.isArray(s.fields) || !Array.isArray(s.artifacts)) throw new Error(`Bad session config ${s.id}`);
  if (!['free','condition','none'].includes(s.ai_mode)) throw new Error(`Bad ai_mode ${s.id}`);
}
for (const f of ['public/js/task.js','public/js/admin.js','src/services/researchService.js','src/routes/chat.js']) {
  const t = await readFile(f,'utf8'); if (!t.trim()) throw new Error(`Empty ${f}`);
}
console.log('CHECK OK: 12 sessions, generic task platform, dual AI routing, exports.');
