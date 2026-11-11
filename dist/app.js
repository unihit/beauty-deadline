import {categories,statuses,deadline,today,candidates,paoCandidates,validateProduct} from './dates.js';
import {all,write} from './db.js';
import {initGoogleAuth,disconnectGoogle,syncWithDrive,getSyncMeta,recordDeletion,isConnected,getStoredClientId,setStoredClientId} from './gdrive.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let products=[],editing=null,photo='',ocrPhoto='',quick='',restoreItems=null,busy=false,photoBusy=false,installPrompt,syncTimer=null;
const form=$('#productForm'),el=n=>form.elements.namedItem(n);
for(const [selector,options] of [['#categoryFilter',categories],['select[name=category]',categories],['#statusFilter',statuses],['select[name=status]',statuses]])$(selector).insertAdjacentHTML('beforeend',options.map(x=>`<option>${x}</option>`).join(''));
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('is-visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('is-visible'),4000);}
function setToday(){const d=new Date();$('#todayLabel').textContent=`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;}
function confirmAction(title,body){$('#confirmTitle').textContent=title;$('#confirmBody').textContent=body;$('#confirmDialog').showModal();return new Promise(resolve=>{let done=v=>{$('#confirmDialog').close();resolve(v)};$('#confirmYes').onclick=()=>done(true);$('#confirmCancel').onclick=()=>done(false);$('#confirmDialog').oncancel=e=>{e.preventDefault();done(false)}});}
async function refresh(){products=await all();render();}
function triggerAutoSync(){if(!isConnected())return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>runDriveSync(true).catch(e=>console.warn('Auto-sync failed:',e)),3000);}
async function runDriveSync(silent=false){
  const statusEl=$('#gdriveStatus');
  if(!silent){statusEl.textContent='구글 드라이브와 동기화 중…';statusEl.classList.remove('is-error');}
  try{
    const readOnly=isViewOnlyMode();
    const res=await syncWithDrive(products,{readOnlyPull:readOnly});
    await write(res.mergedProducts);
    await refresh();
    updateGDriveUI();
    if(!silent)toast(readOnly?`구글 드라이브에서 최신 화장대를 가져왔어요 (${res.count}개).`:`구글 드라이브 동기화 완료 (${res.count}개 제품).`);
  }catch(err){
    statusEl.textContent='동기화 실패: '+err.message;
    statusEl.classList.add('is-error');
    if(!silent)toast('동기화 실패: '+err.message);
    throw err;
  }
}
function updateGDriveUI(){
  const meta=getSyncMeta(),connected=isConnected(),badge=$('#gdriveBadge');
  if($('#gdriveClientId'))$('#gdriveClientId').value=meta.clientId||'';
  if(!badge)return;
  if(connected){
    badge.textContent='동기화 연결됨';
    badge.className='badge';
    $('#gdriveConnect').hidden=true;
    $('#gdriveSyncNow').hidden=false;
    $('#gdriveDisconnect').hidden=false;
    const timeStr=meta.lastSyncedAt?new Date(meta.lastSyncedAt).toLocaleString('ko-KR'):'방금 전';
    $('#gdriveStatus').textContent=`최근 동기화: ${timeStr}`;
    $('#gdriveStatus').classList.remove('is-error');
  }else{
    badge.textContent='연결 안 됨';
    badge.className='badge unknown';
    $('#gdriveConnect').hidden=false;
    $('#gdriveSyncNow').hidden=true;
    $('#gdriveDisconnect').hidden=true;
    if(meta.lastSyncedAt){
      $('#gdriveStatus').textContent=`이전 동기화 기록: ${new Date(meta.lastSyncedAt).toLocaleString('ko-KR')}`;
    }
  }
}
const PHOTO_PLACEHOLDER='<svg viewBox="0 0 64 96" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><rect x="19" y="26" width="26" height="58" rx="7"/><rect x="25" y="14" width="14" height="12" rx="2.5"/><path d="M25 48h14M25 56h14M25 64h9"/></svg>';
const ARROW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
function cardHTML(p){
  const d=deadline(p),completed=['사용 완료','폐기'].includes(p.status);
  const tag=completed?'done':!d.date?'unknown':d.days<0?'expired':d.days<=30?'soon':'';
  const flag=completed?'관리 종료':!d.date?'날짜 미정':d.days<0?`${Math.abs(d.days)}일 지남`:d.days===0?'D-DAY':`D-${d.days}`;
  const quickBtn=p.status==='미개봉'?`<button type="button" class="quick-act" data-open-now="${esc(p.id)}" aria-label="${esc(p.name)} 오늘 개봉">오늘 개봉</button>`:p.status==='사용 중'?`<button type="button" class="quick-act" data-finish-now="${esc(p.id)}" aria-label="${esc(p.name)} 사용 완료">사용 완료</button>`:'';
  return `<article class="card${completed?' is-done':''}"><div class="card-media">${p.photo?`<img src="${p.photo}" alt="${esc(p.name)} 사진" loading="lazy">`:`<span class="card-ph">${PHOTO_PLACEHOLDER}</span>`}<span class="card-flag ${tag}">${flag}</span><span class="card-status">${esc(p.status)}</span></div><div class="card-body"><p class="card-brand">${esc(p.brand||'나의 뷰티 기록')}</p><h3>${esc(p.name)}</h3><div class="card-meta"><span class="badge ${tag}">${completed?'관리 종료':d.label}</span><span class="card-date">${d.date?esc(d.date):'—'}</span></div><p class="reason${d.partial?' is-warn':''}" title="${esc(d.reason)}">${esc(d.reason)}</p><div class="card-foot"><span>${esc(p.category)}<i></i>${p.months?esc(p.months)+'M':'기간 미입력'}</span><div class="card-actions">${quickBtn}<button type="button" data-edit="${esc(p.id)}" aria-label="${esc(p.name)} 수정">기록 보기${ARROW}</button></div></div></div></article>`;
}
function emptyHTML(){
  return `<div class="empty"><div class="empty-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M20 4c-8 0-13 4-13 10 0 3 2 5 5 5 6 0 8-6 8-15Z"/><path d="M4 21c2-6 6-9 11-11"/></svg></div><h3>${products.length?'조건에 맞는 제품이 없어요':'아직 비어 있는 나의 화장대'}</h3><p>${products.length?'검색어나 필터를 바꿔 보세요.':'첫 번째 화장품을 기록해 보세요.<br>제품을 등록하면 먼저 써야 할 순서로 정리해 드려요.'}</p>${products.length?'<button class="secondary" id="emptyReset" type="button">필터 초기화</button>':'<button class="secondary" id="emptyAdd" type="button">＋ 제품 등록하기</button>'}</div>`;
}
function render(){
  const active=products.filter(p=>!['사용 완료','폐기'].includes(p.status));
  const counts={expired:0,soon:0,unknown:0};
  for(const p of active){const d=deadline(p);if(!d.date)counts.unknown++;else if(d.days<0)counts.expired++;else if(d.days<=30)counts.soon++;}
  $('#total').textContent=active.length;
  for(const k in counts)$('#'+k).textContent=counts[k];
  document.querySelectorAll('[data-quick]').forEach(b=>{const on=b.dataset.quick===quick;b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',String(on));});
  const q=$('#search').value.trim().toLocaleLowerCase();
  let list=products.filter(p=>{const d=deadline(p),isActive=active.includes(p);return (!q||[p.name,p.brand,p.memo].some(x=>x.toLocaleLowerCase().includes(q)))&&(!$('#categoryFilter').value||p.category===$('#categoryFilter').value)&&(!$('#statusFilter').value||p.status===$('#statusFilter').value)&&(!quick||(isActive&&(quick==='active'||quick==='unknown'&&!d.date||quick==='expired'&&d.days!==null&&d.days<0||quick==='soon'&&d.days!==null&&d.days>=0&&d.days<=30)));});
  list.sort((a,b)=>$('#sort').value==='new'?b.createdAt.localeCompare(a.createdAt):$('#sort').value==='name'?a.name.localeCompare(b.name,'ko'):(Number(!active.includes(a))-Number(!active.includes(b))||(deadline(a).date||'9999').localeCompare(deadline(b).date||'9999')||a.name.localeCompare(b.name,'ko')));
  $('#count').textContent=list.length+'개';
  $('#quickBar').hidden=!quick;
  $('#quickText').textContent=({active:'관리 중인 제품',expired:'기한 경과',soon:'30일 이내',unknown:'날짜 확인 필요'})[quick]||'';
  $('#cards').innerHTML=list.length?list.map(cardHTML).join(''):emptyHTML();
  $('#emptyAdd')?.addEventListener('click',()=>openEditor());
  $('#emptyReset')?.addEventListener('click',()=>{quick='';$('#search').value='';$('#categoryFilter').value='';$('#statusFilter').value='';render();});
}
function draft(){return {name:el('name').value.trim(),brand:el('brand').value.trim(),category:el('category').value,status:el('status').value,expiry:el('expiry').value,opened:el('opened').value,months:el('months').value?+el('months').value:null,memo:el('memo').value,photo};}
function syncPaoChips(){
  const cur=el('months').value?String(+el('months').value):'';
  document.querySelectorAll('#paoChips [data-pao]').forEach(b=>{
    const on=b.dataset.pao!==''&&b.dataset.pao===cur;
    b.classList.toggle('is-active',on);
    b.setAttribute('aria-pressed',String(on));
  });
}
function calculation(){
  const dr=draft(),d=deadline(dr),calcEl=$('#calculation');
  syncPaoChips();
  if(dr.opened&&dr.opened>today()){
    calcEl.textContent='확인 필요: 개봉일이 오늘보다 미래입니다. 날짜를 확인해 주세요.';
    calcEl.classList.add('is-warn');
    return;
  }
  if(dr.status==='미개봉'&&dr.opened){
    calcEl.textContent='확인 필요: 개봉일이 입력되어 있습니다. 상태를 ‘사용 중’으로 바꾸거나 개봉일을 지워 주세요.';
    calcEl.classList.add('is-warn');
    return;
  }
  calcEl.textContent=`관리 기준일: ${d.date||'날짜 확인 필요'} · ${d.reason}`;
  calcEl.classList.toggle('is-warn',Boolean(d.partial));
}
function isMobileDevice(){
  const small=window.innerWidth<=768;
  const touch=('ontouchstart' in window)||(navigator.maxTouchPoints>0);
  const pwa=window.matchMedia('(display-mode: standalone)').matches;
  return small||(touch&&window.innerWidth<=1024)||pwa;
}
function isPcEditModeEnabled(){
  return localStorage.getItem('beauty_pc_edit_mode')==='true';
}
function setPcEditModeEnabled(v){
  if(v)localStorage.setItem('beauty_pc_edit_mode','true');
  else localStorage.removeItem('beauty_pc_edit_mode');
  updateModeUI();
}
function isViewOnlyMode(){
  if(isMobileDevice())return false;
  return !isPcEditModeEnabled();
}
function updateModeUI(){
  const badge=$('#modeBadge'),label=$('#modeLabel'),toggle=$('#pcEditToggle'),mobile=isMobileDevice(),pcEdit=isPcEditModeEnabled();
  if(toggle)toggle.checked=pcEdit;
  if(!badge||!label)return;
  if(mobile){
    badge.className='mode-badge is-mobile';
    label.textContent='모바일 모드';
    badge.title='모바일 기기: 입력 및 수정 메인 모드';
  }else if(pcEdit){
    badge.className='mode-badge is-editing';
    label.textContent='PC 임시 편집';
    badge.title='클릭하면 PC 조회 전용 모드로 전환됩니다';
  }else{
    badge.className='mode-badge is-viewer';
    label.textContent='조회 전용';
    badge.title='클릭하면 PC 임시 편집 모드로 전환됩니다';
  }
}
function openDetail(id){
  const p=products.find(x=>x.id===id);
  if(!p)return;
  const d=deadline(p);
  const completed=['사용 완료','폐기'].includes(p.status);
  const tag=completed?'unknown':d.days===null?'unknown':d.days<0?'red':d.days<=30?'amber':'green';

  $('#detailTitle').textContent=p.name;
  $('#detailName').textContent=p.name;
  $('#detailBrand').textContent=p.brand||'브랜드 미기입';
  $('#detailCategory').textContent=p.category||'기타';
  $('#detailStatus').textContent=p.status||'미개봉';

  const badgeEl=$('#detailDeadlineBadge');
  badgeEl.className=`badge ${tag}`;
  badgeEl.textContent=completed?'관리 종료':d.label;

  if(p.photo){
    $('#detailPhotoWrap').hidden=false;
    $('#detailPhoto').src=p.photo;
  }else{
    $('#detailPhotoWrap').hidden=true;
    $('#detailPhoto').src='';
  }

  $('#detailExpiry').textContent=p.expiry||'미입력';
  $('#detailOpened').textContent=p.opened||(p.status==='미개봉'?'미개봉 상태':'미입력');
  $('#detailMonths').textContent=p.months?`${p.months}개월 (${p.months}M)`:'기간 미입력';
  $('#detailTargetDate').textContent=d.date?`${d.date} (${d.days!==null?(d.days>=0?`D-${d.days}`:`D+${Math.abs(d.days)}`):''})`:'날짜 확인 필요';

  const reasonBox=$('#detailReasonBox');
  if(d.reason){
    reasonBox.hidden=false;
    reasonBox.textContent=`기준 안내: ${d.reason}`;
  }else{
    reasonBox.hidden=true;
  }

  const memoSec=$('#detailMemoSection');
  if(p.memo&&p.memo.trim()){
    memoSec.hidden=false;
    $('#detailMemo').textContent=p.memo.trim();
  }else{
    memoSec.hidden=true;
  }

  $('#detailEditBtn').onclick=()=>{
    $('#detailDialog').close();
    openEditor(p.id);
  };

  $('#detailDialog').showModal();
}
function setPhoto(v,ocrV=v){photo=v;ocrPhoto=ocrV;$('#photoPreview').hidden=!v;$('#photoPreview').src=v||'';}
function openEditor(id){if(busy||photoBusy)return;editing=products.find(p=>p.id===id)||null;form.reset();$('#ocrPanel').hidden=true;$('#ocrText').value='';$('#dateCandidates').innerHTML='';$('#paoCandidates').innerHTML='';$('#formError').textContent='';$('#editorTitle').textContent=editing?'제품 기록 수정':'제품 등록';$('#delete').hidden=!editing;for(const n of ['name','brand','category','status','expiry','opened','months','memo'])if(editing)el(n).value=editing[n]??'';setPhoto(editing?.photo||'');calculation();$('#editor').showModal();}
function controls(){ $('#save').disabled=busy||photoBusy;$('#ocr').disabled=busy||photoBusy;$('#photo').disabled=busy||photoBusy;$('#removePhoto').disabled=busy||photoBusy;$('#delete').disabled=busy||photoBusy;}
function handleAddProduct(){
  if(isViewOnlyMode()){
    confirmAction('PC에서 제품을 등록할까요?','모바일이 메인 입력 기기입니다. PC에서 임시로 새 제품을 등록하시겠습니까?').then(yes=>{
      if(yes)openEditor();
    });
  }else{
    openEditor();
  }
}
$('#add').onclick=handleAddProduct;
$('#headerAdd').onclick=handleAddProduct;
$('#modeBadge')?.addEventListener('click',()=>{
  if(isMobileDevice()){
    toast('모바일 기기는 언제나 입력·수정이 가능한 메인 모드로 동작합니다.');
    return;
  }
  const next=!isPcEditModeEnabled();
  setPcEditModeEnabled(next);
  toast(next?'PC 임시 편집 모드를 켰어요. 제품 등록과 수정이 가능합니다.':'PC 조회 전용 모드로 전환했어요. 안전하게 둘러보실 수 있습니다.');
});
$('#pcEditToggle')?.addEventListener('change',e=>{
  setPcEditModeEnabled(e.target.checked);
  toast(e.target.checked?'PC 임시 편집 모드를 켰어요.':'PC 조회 전용 모드로 전환했어요.');
});
window.addEventListener('resize',updateModeUI);
$('#cards').onclick=async e=>{
  const openBtn=e.target.closest('[data-open-now]');
  if(openBtn){
    if(isViewOnlyMode()){
      toast('PC는 조회 전용 모드입니다. 상태 변경은 모바일에서 진행하거나 PC 임시 편집 모드를 켜주세요.');
      return;
    }
    const p=products.find(x=>x.id===openBtn.dataset.openNow);
    if(!p)return;
    const openedDate=p.opened&&p.opened<=today()?p.opened:today();
    await write([{...p,status:'사용 중',opened:openedDate,updatedAt:new Date().toISOString()}]);
    await refresh();
    triggerAutoSync();
    toast(`‘${p.name}’을(를) 사용 중(개봉일 ${openedDate})으로 기록했어요.`);
    return;
  }
  const finishBtn=e.target.closest('[data-finish-now]');
  if(finishBtn){
    if(isViewOnlyMode()){
      toast('PC는 조회 전용 모드입니다. 상태 변경은 모바일에서 진행하거나 PC 임시 편집 모드를 켜주세요.');
      return;
    }
    const p=products.find(x=>x.id===finishBtn.dataset.finishNow);
    if(!p)return;
    await write([{...p,status:'사용 완료',updatedAt:new Date().toISOString()}]);
    await refresh();
    triggerAutoSync();
    toast(`‘${p.name}’ 사용 완료를 기록했어요.`);
    return;
  }
  const b=e.target.closest('[data-edit]');
  if(b){
    if(isViewOnlyMode()){
      openDetail(b.dataset.edit);
    }else{
      openEditor(b.dataset.edit);
    }
  }
};
for(const s of ['#search','#categoryFilter','#sort'])$(s).addEventListener('input',render);
$('#statusFilter').addEventListener('input',()=>{
  if(['사용 완료','폐기'].includes($('#statusFilter').value)&&quick)quick='';
  render();
});
document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{
  quick=quick===b.dataset.quick?'':b.dataset.quick;
  if(quick&&['사용 완료','폐기'].includes($('#statusFilter').value))$('#statusFilter').value='';
  render();
});
$('#clearQuick').onclick=()=>{quick='';render()};
el('opened').addEventListener('change',()=>{
  if(el('opened').value&&el('status').value==='미개봉'){
    el('status').value='사용 중';
    toast('개봉일을 입력해 상태를 ‘사용 중’으로 자동 변경했어요.');
  }
  calculation();
});
$('#openedToday').onclick=()=>{
  el('opened').value=today();
  if(el('status').value==='미개봉')el('status').value='사용 중';
  calculation();
};
$('#openedClear').onclick=()=>{
  el('opened').value='';
  calculation();
};
$('#paoChips').onclick=e=>{
  const b=e.target.closest('[data-pao]');
  if(!b)return;
  el('months').value=b.dataset.pao;
  calculation();
};
form.addEventListener('input',calculation);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(busy||photoBusy)return;$('#'+b.dataset.close).close()});
for(const dlg of ['#editor','#backupDialog','#detailDialog']){
  $(dlg).addEventListener('click',e=>{if(e.target===$(dlg)&&!busy&&!photoBusy)$(dlg).close()});
}
$('#editor').addEventListener('cancel',e=>{if(busy||photoBusy)e.preventDefault()});
form.onsubmit=async e=>{e.preventDefault();if(busy||photoBusy)return;$('#formError').textContent='';try{const raw=draft();if(raw.status==='미개봉'&&raw.opened)raw.status='사용 중';const p=validateProduct({...raw,id:editing?.id||crypto.randomUUID(),createdAt:editing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});if(p.opened>today())throw Error('개봉일이 오늘보다 미래입니다. 날짜를 확인해 주세요.');busy=true;controls();await write([p]);await refresh();triggerAutoSync();$('#editor').close();toast('제품 기록을 저장했어요.');}catch(e){$('#formError').textContent='저장하지 못했어요. '+e.message;}finally{busy=false;controls()}};
$('#delete').onclick=async()=>{if(!editing||busy)return;if(await confirmAction('제품을 삭제할까요?',`‘${editing.name}’의 사진과 기록이 이 브라우저에서 삭제됩니다.`)){try{recordDeletion(editing.id);await write([],editing.id);await refresh();triggerAutoSync();$('#editor').close();toast('제품을 삭제했어요.')}catch(e){$('#formError').textContent=e.message}}};
function resizeImage(img,maxDim,quality){
  const scale=Math.min(1,maxDim/Math.max(img.width,img.height)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(img.width*scale));
  c.height=Math.max(1,Math.round(img.height*scale));
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',quality);
}
$('#photo').onchange=async e=>{const f=e.target.files[0];if(!f)return;photoBusy=true;controls();try{if(f.size>20000000)throw Error('20MB 이하의 사진을 선택해 주세요.');const url=URL.createObjectURL(f);try{const img=new Image();img.src=url;await img.decode();const thumb=resizeImage(img,720,.82),hiRes=resizeImage(img,2200,.88);setPhoto(thumb,hiRes);}finally{URL.revokeObjectURL(url)}}catch(e){$('#formError').textContent='사진을 읽지 못했어요. JPG·PNG·WebP로 다시 선택하거나 수동 입력해 주세요. '+e.message;}finally{photoBusy=false;controls()}};
$('#removePhoto').onclick=()=>{setPhoto('');$('#photo').value=''};
let enginePromise;
function loadEngine(){return enginePromise??=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=resolve;s.onerror=()=>{enginePromise=null;s.remove();reject(Error('OCR 엔진 다운로드 실패. 인터넷 연결을 확인해 주세요.'))};document.head.append(s)});}
function showCandidates(){
  const text=$('#ocrText').value,cs=candidates(text),paos=paoCandidates(text);
  $('#dateCandidates').innerHTML=cs.length?cs.map((c,i)=>`<button type="button" data-date-index="${i}" ${c.manufacture?'disabled class="manufacture"':''}>${esc(c.date)} · ${c.manufacture?'제조일 문맥 · 적용 불가':c.explicit?'사용기한 문맥 후보 · 확인 후 적용':'종류 불명 · 라벨에서 EXP인지 확인 후 적용'}<br>${esc(c.context)}</button>`).join(''):'<p class="hint">날짜 후보를 찾지 못했어요. 원문과 사진을 확인하고 직접 입력해 주세요.</p>';
  $('#dateCandidates').onclick=async e=>{const b=e.target.closest('[data-date-index]');if(!b)return;const c=cs[+b.dataset.dateIndex];if(c.manufacture)return;if(await confirmAction('사용기한이 맞나요?',`${c.date} · 사진에서 제조일이 아닌 EXP·사용기한인지 직접 확인한 후 적용하세요.`)){el('expiry').value=c.date;calculation();toast('사용기한 후보를 입력했어요. 저장 전 확인해 주세요.')}};
  $('#paoCandidates').innerHTML=paos.length?paos.map(m=>`<button type="button" class="chip-btn" data-ocr-pao="${m}">개봉 후 ${m}개월 (${m}M) 적용</button>`).join(''):'';
  $('#paoCandidates').onclick=e=>{const b=e.target.closest('[data-ocr-pao]');if(!b)return;el('months').value=b.dataset.ocrPao;calculation();toast(`개봉 후 사용기간 ${b.dataset.ocrPao}개월을 입력했어요.`);};
}
$('#parseOcr').onclick=showCandidates;$('#applyName').onclick=()=>{if($('#ocrName').value.trim()){el('name').value=$('#ocrName').value.trim();toast('제품명을 입력했어요.')}};
$('#ocr').onclick=async()=>{if(!photo){toast('제품 사진을 먼저 선택해 주세요.');return}busy=true;controls();$('#ocrPanel').hidden=false;$('#ocrProgress').value=0;$('#ocrText').value='';$('#dateCandidates').innerHTML='';$('#paoCandidates').innerHTML='';$('#ocrName').value='';$('#ocrStatus').textContent='최초 사용 시 엔진·언어 모델을 다운로드합니다. 잠시 기다려 주세요…';let worker;try{await loadEngine();worker=await Tesseract.createWorker('kor+eng',1,{logger:m=>{$('#ocrProgress').value=Math.round((m.progress||0)*100);const labels={'loading tesseract core':'OCR 엔진 다운로드','initializing tesseract':'엔진 준비','loading language traineddata':'한국어·영어 모델 다운로드','initializing api':'언어 모델 준비','recognizing text':'사진의 글자 인식'};$('#ocrStatus').textContent=(labels[m.status]||'OCR 준비 중')+(m.progress===undefined?'':` · ${Math.round(m.progress*100)}%`);}});const {data}=await worker.recognize(ocrPhoto||photo);$('#ocrText').value=data.text;$('#ocrName').value=(data.text.split('\n').map(x=>x.trim()).find(x=>x.length>2&&!/\d|EXP|MFG|제조|사용기한/i.test(x))||'').slice(0,120);showCandidates();$('#ocrStatus').textContent=data.text.trim()?'인식 완료 · 원문과 사진을 비교한 후 적용해 주세요.':'글자를 찾지 못했어요. 밝은 곳에서 라벨을 가까이 찍거나 수동으로 입력해 주세요.';}catch(e){$('#ocrStatus').textContent='OCR을 완료하지 못했어요. 인터넷 연결과 사진 형식을 확인하고 다시 시도하거나 수동 입력해 주세요. '+e.message;}finally{if(worker)await worker.terminate().catch(()=>{});busy=false;controls()}};
$('#sample').onclick=async()=>{if(!await confirmAction('샘플을 추가할까요?','가상 제품 4개가 개별 용기로 등록됩니다. 실제 제품이 아니며 기록 보기에서 삭제할 수 있어요.'))return;try{const base={brand:'뷰티기한 샘플',category:'스킨케어',status:'사용 중',opened:'',months:null,memo:'사용법을 살펴보기 위한 가상 샘플',photo:''},shift=n=>{const d=new Date(today()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};await write([['[샘플] 수분 크림',shift(14)],['[샘플] 선크림',shift(-5)],['[샘플] 립 틴트',''],['[샘플] 클렌징 밀크',shift(100)]].map(([name,expiry],i)=>({...base,name,expiry,category:categories[i],id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})));await refresh();triggerAutoSync();toast('가상 샘플 4개를 추가했어요.')}catch(e){toast('샘플 저장 실패: '+e.message)}};
for(const s of ['#backupOpen','#backupInline'])$(s).onclick=()=>{updateGDriveUI();$('#backupDialog').showModal();};
$('#gdriveClientId')?.addEventListener('input',e=>setStoredClientId(e.target.value));
$('#gdriveConnect')?.addEventListener('click',async()=>{
  const cId=$('#gdriveClientId').value.trim();
  if(!cId){toast('Google OAuth 클라이언트 ID를 입력해 주세요.');$('#gdriveClientId').focus();return;}
  try{
    $('#gdriveStatus').textContent='구글 로그인 창을 여는 중…';
    $('#gdriveStatus').classList.remove('is-error');
    await initGoogleAuth(cId);
    await runDriveSync(false);
  }catch(err){
    $('#gdriveStatus').textContent='연결 실패: '+err.message;
    $('#gdriveStatus').classList.add('is-error');
  }
});
$('#gdriveSyncNow')?.addEventListener('click',()=>runDriveSync(false));
$('#gdriveDisconnect')?.addEventListener('click',()=>{
  disconnectGoogle();
  updateGDriveUI();
  toast('구글 드라이브 연결을 해제했어요.');
});
$('#export').onclick=async()=>{try{const data={app:'beauty-deadline',version:1,exportedAt:new Date().toISOString(),products:await all()},url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`뷰티기한-백업-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('#backupStatus').textContent='백업 다운로드를 요청했어요. 다운로드 폴더를 확인하세요.';}catch(e){$('#backupStatus').textContent='백업 실패: '+e.message}};
$('#importFile').onchange=async e=>{restoreItems=null;$('#restorePreview').hidden=true;try{const file=e.target.files[0];if(!file)return;if(file.size>100000000)throw Error('100MB 이하의 백업만 지원합니다.');const data=JSON.parse(await file.text());if(data.app!=='beauty-deadline'||data.version!==1||!Array.isArray(data.products)||data.products.length>2000)throw Error('뷰티기한 버전 1 백업인지 확인해 주세요.');const ids=new Set();restoreItems=data.products.map(p=>{validateProduct(p);if(ids.has(p.id))throw Error('중복 ID가 있는 백업입니다.');ids.add(p.id);if(typeof p.createdAt!=='string'||typeof p.updatedAt!=='string'||isNaN(Date.parse(p.createdAt))||isNaN(Date.parse(p.updatedAt)))throw Error('등록 시각이 올바르지 않습니다.');return Object.fromEntries(['id','name','brand','category','status','expiry','opened','months','memo','photo','createdAt','updatedAt'].map(k=>[k,p[k]??(k==='months'?null:'')]))});const overlap=restoreItems.filter(p=>products.some(q=>q.id===p.id)).length;$('#restoreInfo').textContent=`총 ${restoreItems.length}개 · 새로 추가 ${restoreItems.length-overlap}개 · 같은 ID 덮어쓰기 ${overlap}개`;$('#restorePreview').hidden=false;$('#backupStatus').textContent='내용을 확인한 후 복원 버튼을 눌러 주세요.';}catch(e){restoreItems=null;$('#backupStatus').textContent='복원 파일을 읽지 못했어요. '+e.message}};
$('#restore').onclick=async()=>{if(!restoreItems)return;$('#restore').disabled=true;try{await write(restoreItems);await refresh();triggerAutoSync();$('#backupStatus').textContent=`${restoreItems.length}개 제품을 복원했어요.`;restoreItems=null;$('#restorePreview').hidden=true;$('#importFile').value='';toast('백업 복원을 완료했어요.')}catch(e){$('#backupStatus').textContent='복원 실패. 기존 기록은 유지됩니다. '+e.message}finally{$('#restore').disabled=false}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install').hidden=false});$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden){setToday();refresh().catch(e=>toast(e.message))}});setInterval(()=>{if(!document.hidden)render()},60000);
setToday();updateGDriveUI();updateModeUI();try{await refresh()}catch(e){$('#cards').innerHTML='<div class="empty"><h3>저장 공간을 열 수 없어요</h3><p>브라우저의 저장 공간 권한과 비공개 모드를 확인하고 다시 열어 주세요.</p></div>';toast('저장소 오류: '+e.message)}
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>toast('오프라인 준비에 실패했어요. 온라인에서는 계속 사용할 수 있습니다.'));
