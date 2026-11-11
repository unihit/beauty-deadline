import {test} from 'node:test';import assert from 'node:assert/strict';import {addMonths,deadline,validDate,candidates,paoCandidates,validateProduct} from './dist/dates.js';
import {mergeProducts} from './dist/gdrive.js';

test('month ends and leap years',()=>{assert.equal(addMonths('2024-01-31',1),'2024-02-29');assert.equal(addMonths('2023-01-31',1),'2023-02-28');assert.equal(addMonths('2024-02-29',12),'2025-02-28');assert.equal(addMonths('2026-08-31',6),'2027-02-28');assert.equal(addMonths('2026-12-31',3),'2027-03-31')});
test('invalid dates rejected',()=>{for(const d of ['2026-02-29','2026-04-31','2026-00-01','26-01-01',''])assert.equal(validDate(d),false)});
test('earliest date and missing information',()=>{assert.equal(deadline({status:'사용 중',expiry:'2027-01-01',opened:'2026-08-31',months:3}).date,'2026-11-30');assert.equal(deadline({status:'사용 중',expiry:'2026-10-01',opened:'2026-08-31',months:3}).date,'2026-10-01');assert.equal(deadline({status:'미개봉',opened:'2026-01-01',months:3}).date,null);assert.equal(deadline({status:'사용 중',months:6}).date,null);assert.equal(deadline({manufactured:'2026-01-01'}).date,null)});
test('partial open information flagged',()=>{
  const missingOpened=deadline({status:'사용 중',expiry:'2027-08-01',opened:'',months:6},'2026-10-27');
  assert.equal(missingOpened.date,'2027-08-01');
  assert.equal(missingOpened.partial,true);
  assert.match(missingOpened.reason,/개봉일 미입력/);
  const missingMonths=deadline({status:'사용 중',expiry:'2027-08-01',opened:'2026-10-01',months:null},'2026-10-27');
  assert.equal(missingMonths.date,'2027-08-01');
  assert.equal(missingMonths.partial,true);
  assert.match(missingMonths.reason,/개봉 후 사용기간 미입력/);
});
test('classification boundaries',()=>{for(const [d,label] of [['2026-10-26','기한 경과'],['2026-10-27','30일 이내'],['2026-11-26','30일 이내'],['2026-11-27','여유 있어요']])assert.equal(deadline({expiry:d},'2026-10-27').label,label)});
test('OCR candidates and manufacture guard',()=>{
  let c=candidates('MFG 2026.01.31\nEXP 2027.02.28');
  assert.equal(c.length,2);
  assert.equal(c[0].manufacture,true);
  assert.equal(c[1].manufacture,false);
  assert.equal(c[1].explicit,true);
  assert.equal(candidates('EXP 2026.02.30').length,0);

  let kr=candidates('2025.05.10 제조\n2028.05.09 까지');
  assert.equal(kr.length,2);
  assert.equal(kr[0].date,'2025-05-10');
  assert.equal(kr[0].manufacture,true);
  assert.equal(kr[0].explicit,false);
  assert.equal(kr[1].date,'2028-05-09');
  assert.equal(kr[1].manufacture,false);
  assert.equal(kr[1].explicit,true);

  let sameLine=candidates('2025.05.10 제조 / 2028.05.09 까지');
  assert.equal(sameLine.length,2);
  assert.equal(sameLine[0].manufacture,true);
  assert.equal(sameLine[1].manufacture,false);
  assert.equal(sameLine[1].explicit,true);

  let compact=candidates('EXP 20270515 까지\n사용기한 28.06.30');
  assert.equal(compact.length,2);
  assert.equal(compact[0].date,'2027-05-15');
  assert.equal(compact[0].explicit,true);
  assert.equal(compact[1].date,'2028-06-30');
  assert.equal(compact[1].explicit,true);

  assert.deepEqual(paoCandidates('12M / 개봉 후 6개월 이내 사용'),[12,6]);
});
test('backup rejects executable image and invalid months',()=>{const p={id:'x',name:'x',brand:'',memo:'',category:'스킨케어',status:'미개봉',photo:'',expiry:'',opened:'',months:null};assert.equal(validateProduct(p),p);assert.throws(()=>validateProduct({...p,photo:'javascript:alert(1)'}));assert.throws(()=>validateProduct({...p,months:2.5}));});

test('Google Drive merge logic respects updated timestamps and tombstones', () => {
  const local = [{id: '1', name: '로컬 크림', updatedAt: '2026-11-10T10:00:00Z'}];
  const remote = [
    {id: '1', name: '원격 크림', updatedAt: '2026-11-10T09:00:00Z'},
    {id: '2', name: '원격 토너', updatedAt: '2026-11-10T08:00:00Z'},
    {id: '3', name: '삭제된 세럼', updatedAt: '2026-11-10T07:00:00Z'}
  ];
  const deleted = {'3': '2026-11-10T07:30:00Z'};
  const merged = mergeProducts(local, remote, deleted);
  assert.equal(merged.length, 2);
  const m1 = merged.find(x => x.id === '1');
  assert.equal(m1.name, '로컬 크림');
  assert.equal(merged.some(x => x.id === '2'), true);
  assert.equal(merged.some(x => x.id === '3'), false);
});

import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('service worker isolates app paths and cache namespaces',async()=>{
  const handlers={},deleted=[],scope='https://unihit.github.io/beauty-deadline/';
  const prefix='beauty-deadline:'+scope+':';
  const context={URL,Response,self:{registration:{scope},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{}},skipWaiting:async()=>{}},
    caches:{open:async()=>({put:async()=>{}}),keys:async()=>['beauty-v3','other-app',prefix+'v5',prefix+'v6',prefix+'v7',prefix+'v8',prefix+'v9',prefix+'v10',prefix+'v11',prefix+'v12'],delete:async key=>deleted.push(key)}};
  vm.runInNewContext(readFileSync(new URL('./dist/sw.js',import.meta.url),'utf8'),context);
  let pending;
  handlers.activate({waitUntil:p=>pending=p});await pending;
  assert.deepEqual(deleted,[prefix+'v5',prefix+'v6',prefix+'v7',prefix+'v8',prefix+'v9',prefix+'v10',prefix+'v11']);
  for(const url of ['https://unihit.github.io/ssen-ledger/','https://unihit.github.io/beauty-deadline-other/','https://example.com/beauty-deadline/']){
    let intercepted=false;
    handlers.fetch({request:{method:'GET',url},respondWith:()=>intercepted=true});
    assert.equal(intercepted,false,url);
  }
  context.fetch=async()=>new Response('ok');
  let intercepted;
  handlers.fetch({request:{method:'GET',url:scope+'app.js'},waitUntil:()=>{},respondWith:p=>intercepted=p});
  // Cache failures must not hide the online response.
  assert.equal((await intercepted).status,200);
});
