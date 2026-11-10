export const statuses=['미개봉','사용 중','사용 완료','폐기'];
export const categories=['스킨케어','메이크업','선케어','클렌징','헤어·바디','향수','기타'];
export function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;let d=new Date(s+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===s&&+s.slice(0,4)>=1900;}
export function addMonths(s,m){if(!validDate(s)||!Number.isInteger(+m)||+m<1||+m>120)return null;const [y,mo,d]=s.split('-').map(Number);const last=new Date(Date.UTC(y,mo-1+(+m)+1,0)).getUTCDate();return new Date(Date.UTC(y,mo-1+(+m),Math.min(d,last))).toISOString().slice(0,10);}
export function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function deadline(p,now=today()){
  let list=[];
  if(validDate(p.expiry))list.push({date:p.expiry,reason:'표시된 사용기한'});
  const isOpened=p.status&&p.status!=='미개봉';
  const hasOpenedDate=validDate(p.opened),hasMonths=Boolean(p.months&&Number.isInteger(+p.months)&&+p.months>=1&&+p.months<=120);
  if(isOpened&&hasOpenedDate&&hasMonths){
    const date=addMonths(p.opened,+p.months);
    if(date)list.push({date,reason:`개봉일 ${p.opened} + ${+p.months}개월`});
  }
  const partialNote=p.status==='사용 중'?(hasOpenedDate&&!hasMonths?'개봉 후 사용기간 미입력(표시 기한만 반영)':!hasOpenedDate&&hasMonths?'개봉일 미입력(표시 기한만 반영)':''):'';
  list.sort((a,b)=>a.date.localeCompare(b.date));
  if(!list.length){
    const emptyReason=p.status==='사용 중'&&hasOpenedDate&&!hasMonths?'개봉 후 사용기간(개월) 또는 표시된 사용기한을 입력하세요.':p.status==='사용 중'&&!hasOpenedDate&&hasMonths?'개봉일 또는 표시된 사용기한을 입력하세요.':'표시된 사용기한 또는 개봉일과 개봉 후 사용기간을 입력하세요.';
    return {date:null,days:null,label:'날짜 확인 필요',reason:emptyReason,partial:Boolean(partialNote)};
  }
  const first=list[0],days=Math.round((new Date(first.date+'T00:00:00Z')-new Date(now+'T00:00:00Z'))/86400000);
  const baseReason=list.map(x=>`${x.reason} → ${x.date}`).join(' / ')+(list.length>1?' · 빠른 날짜 적용':'');
  return {...first,days,label:days<0?'기한 경과':days<=30?'30일 이내':'여유 있어요',reason:baseReason+(partialNote?` · ${partialNote}`:''),partial:Boolean(partialNote)};
}
export function candidates(text){
  if(typeof text!=='string'||!text.trim())return [];
  const pattern=/(?:19|20)\d{2}[.\-/년\s]+\d{1,2}[.\-/월\s]+\d{1,2}일?|(?<!\d)(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)|(?<!\d)(2\d)[.\-/](0[1-9]|1[0-2])[.\-/](0[1-9]|[12]\d|3[01])(?!\d)/g;
  const matches=[...text.matchAll(pattern)];
  const seen=new Set(),result=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],raw=m[0];
    let y,mo,da;
    if(/^\d{8}$/.test(raw)){
      y=raw.slice(0,4);mo=raw.slice(4,6);da=raw.slice(6,8);
    }else{
      const nums=raw.match(/\d+/g);
      if(!nums||nums.length<3)continue;
      y=nums[0].length===2?'20'+nums[0]:nums[0];
      mo=nums[1].padStart(2,'0');
      da=nums[2].padStart(2,'0');
    }
    const date=`${y}-${mo}-${da}`;
    if(!validDate(date))continue;
    const lineStart=text.lastIndexOf('\n',m.index-1)+1;
    const lineEndIdx=text.indexOf('\n',m.index+raw.length);
    const lineEnd=lineEndIdx===-1?text.length:lineEndIdx;
    const prevEnd=(i>0&&matches[i-1].index>=lineStart)?matches[i-1].index+matches[i-1][0].length:lineStart;
    const nextStart=(i+1<matches.length&&matches[i+1].index<lineEnd)?matches[i+1].index:lineEnd;
    const beforeSeg=text.slice(prevEnd,m.index).replace(/^\s*(?:까지|제조|생산)\b/,'');
    const afterSeg=text.slice(m.index+raw.length,nextStart);
    const afterImmediate=afterSeg.match(/^\s*(까지|(?:제조|생산)(?!\s*(?:일|년|번호|국|원|자|사|업|\d{2,4})))/)?.[1]||'';
    const markers=[...beforeSeg.matchAll(/제조|MFG|MFD|생산|EXP|사용기한|소비기한|유통기한/gi)];
    const prefixMarker=markers.at(-1)?.[0]||'';
    const manufacture=/제조|생산/i.test(afterImmediate)||(/제조|MFG|MFD|생산/i.test(prefixMarker)&&!/까지/i.test(afterImmediate));
    const explicit=!manufacture&&(/까지/i.test(afterImmediate)||/EXP|사용기한|소비기한|유통기한/i.test(prefixMarker));
    const context=text.slice(Math.max(lineStart,m.index-20),Math.min(lineEnd,m.index+raw.length+16)).trim();
    const key=`${date}:${manufacture}:${explicit}`;
    if(seen.has(key))continue;
    seen.add(key);
    result.push({date,context,manufacture,explicit});
  }
  return result;
}
export function paoCandidates(text){
  if(typeof text!=='string'||!text.trim())return [];
  const nums=new Set();
  for(const m of text.matchAll(/\b(3|6|9|12|18|24|30|36)\s*M\b|개봉\s*후\s*(\d{1,2})\s*개월/gi)){
    const v=+(m[1]||m[2]);
    if(Number.isInteger(v)&&v>=1&&v<=120)nums.add(v);
  }
  return [...nums];
}
export function validateProduct(p){
  if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name.trim()||p.name.length>120||!statuses.includes(p.status)||!categories.includes(p.category))throw Error('제품 형식이 올바르지 않습니다.');
  for(const k of ['expiry','opened'])if(p[k]&&!validDate(p[k]))throw Error('올바르지 않은 날짜입니다.');
  if(p.months&&(!Number.isInteger(+p.months)||+p.months<1||+p.months>120))throw Error('사용기간은 1~120개월이어야 합니다.');
  for(const k of ['brand','memo'])if(typeof p[k]!=='string'||p[k].length>10000)throw Error('텍스트 형식을 확인하세요.');
  if(typeof p.photo!=='string'||(p.photo&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.photo))||p.photo.length>12000000)throw Error('지원하지 않는 사진입니다.');
  return p;
}
