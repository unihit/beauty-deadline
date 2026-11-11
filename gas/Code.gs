/**
 * 뷰티기한 (Beauty Deadline) - Cloud & Chatbot API for Google Apps Script
 *
 * 구글 드라이브 '뷰티기한/beauty-deadline-data.json'과 실시간 연동.
 * MUSE 챗봇, ChatGPT, 뷰티기한 웹/모바일 앱에서 호출할 수 있는 통합 백엔드 API입니다.
 */

const FOLDER_NAME = '뷰티기한';
const FILE_NAME = 'beauty-deadline-data.json';

const VALID_CATEGORIES = ['스킨케어', '메이크업', '선케어', '클렌징', '헤어·바디', '향수', '기타'];
const VALID_STATUSES = ['미개봉', '사용 중', '사용 완료', '폐기'];

// --------------------------------------------------------------------------
// 보안 토큰 및 인증
// --------------------------------------------------------------------------

function getApiToken() {
  const prop = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  return prop ? prop.trim() : null;
}

function isAuthorized(token) {
  if (!token || typeof token !== 'string') return false;
  const expected = getApiToken();
  if (!expected) return false;
  return token.trim() === expected;
}

// --------------------------------------------------------------------------
// HTTP GET 핸들러
// --------------------------------------------------------------------------

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const token = params.token || '';

    // 1. 인증 검증
    if (!isAuthorized(token)) {
      return jsonResponse({
        success: false,
        error: '인증 실패: 유효한 token이 필요합니다. (예: ?token=YOUR_TOKEN)'
      });
    }

    const action = params.action || 'list';

    // 2. 상태 점검 (ping)
    if (action === 'ping') {
      return jsonResponse({
        success: true,
        action: 'ping',
        app: 'beauty-deadline-api',
        version: 2,
        now: new Date().toISOString()
      });
    }

    const data = getOrCreateData();
    const todayStr = getTodayString();
    const activeProducts = data.products.filter(p => !['사용 완료', '폐기'].includes(p.status));

    // 3. 기한 임박 조회 (expiring)
    if (action === 'expiring') {
      const list = activeProducts
        .map(p => ({ product: p, deadline: calculateDeadline(p, todayStr) }))
        .filter(x => x.deadline.date && x.deadline.days !== null && x.deadline.days <= 30)
        .sort((a, b) => (a.deadline.days || 0) - (b.deadline.days || 0));

      return jsonResponse({
        success: true,
        action: 'expiring',
        count: list.length,
        items: list.map(x => formatProductOutput(x.product, x.deadline))
      });
    }

    // 4. 전체 목록 조회 (list)
    if (action === 'list') {
      const counts = { total: activeProducts.length, expired: 0, soon: 0, unknown: 0 };
      const items = activeProducts.map(p => {
        const d = calculateDeadline(p, todayStr);
        if (!d.date) counts.unknown++;
        else if (d.days < 0) counts.expired++;
        else if (d.days <= 30) counts.soon++;
        return formatProductOutput(p, d);
      });

      return jsonResponse({
        success: true,
        action: 'list',
        summary: counts,
        syncedAt: data.syncedAt,
        products: items
      });
    }

    // 5. 알 수 없는 action은 에러 반환 (조용히 list 반환 금지)
    return jsonResponse({
      success: false,
      error: `알 수 없는 GET action입니다: "${action}". (지원: ping, list, expiring)`
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// --------------------------------------------------------------------------
// HTTP POST 핸들러
// --------------------------------------------------------------------------

function doPost(e) {
  // 동시성 제어: LockService로 동시 저장 시 충돌 방지 (최대 10초 대기)
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(10000);
  if (!hasLock) {
    return jsonResponse({
      success: false,
      error: '현재 다른 작업이 데이터베이스를 처리 중입니다. 잠시 후 다시 시도해 주세요. (Lock Timeout)'
    });
  }

  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    // 1. 인증 검증
    const token = payload.token || (e && e.parameter && e.parameter.token) || '';
    if (!isAuthorized(token)) {
      return jsonResponse({
        success: false,
        error: '인증 실패: payload에 유효한 token이 필요합니다. (예: { "token": "..." })'
      });
    }

    const action = payload.action;
    if (!action) {
      return jsonResponse({
        success: false,
        error: 'action 필드가 누락되었습니다. (지원: add, update, open, finish, discard, delete, sync)'
      });
    }

    const data = getOrCreateData();
    const todayStr = getTodayString();
    const nowStr = new Date().toISOString();

    // ------------------------------------------------------------------------
    // (1) 제품 등록 (add)
    // ------------------------------------------------------------------------
    if (action === 'add') {
      const name = (payload.name || '').trim();
      if (!name) return jsonResponse({ success: false, error: '제품명(name)은 필수입니다.' });
      if (name.length > 120) return jsonResponse({ success: false, error: '제품명은 최대 120자까지 가능합니다.' });

      const category = payload.category || '스킨케어';
      if (!VALID_CATEGORIES.includes(category)) {
        return jsonResponse({
          success: false,
          error: `유효하지 않은 카테고리입니다: "${category}". 지원 카테고리: ${VALID_CATEGORIES.join(', ')}`
        });
      }

      const status = payload.status || (payload.opened ? '사용 중' : '미개봉');
      if (!VALID_STATUSES.includes(status)) {
        return jsonResponse({
          success: false,
          error: `유효하지 않은 상태입니다: "${status}". 지원 상태: ${VALID_STATUSES.join(', ')}`
        });
      }

      const expiry = (payload.expiry || '').trim();
      if (expiry && !isValidDateString(expiry)) {
        return jsonResponse({ success: false, error: `유효하지 않은 사용기한(expiry) 날짜 형식입니다: "${expiry}". (YYYY-MM-DD 필요)` });
      }

      const opened = (payload.opened || '').trim();
      if (opened && !isValidDateString(opened)) {
        return jsonResponse({ success: false, error: `유효하지 않은 개봉일(opened) 날짜 형식입니다: "${opened}". (YYYY-MM-DD 필요)` });
      }

      let months = null;
      if (payload.months !== undefined && payload.months !== null && payload.months !== '') {
        const parsedM = parseInt(payload.months, 10);
        if (isNaN(parsedM) || parsedM < 1 || parsedM > 120) {
          return jsonResponse({ success: false, error: '개봉 후 권장기간(months)은 1~120 사이의 정수여야 합니다.' });
        }
        months = parsedM;
      }

      // 사진 용량 및 형식 검증 (최대 2.5MB)
      let photo = (payload.photo || '').trim();
      if (photo) {
        if (!photo.startsWith('data:image/')) {
          return jsonResponse({ success: false, error: '사진(photo)은 data:image/ 형식의 base64 데이터만 허용됩니다.' });
        }
        if (photo.length > 2800000) {
          return jsonResponse({ success: false, error: '사진 용량이 너무 큽니다. (최대 2MB 이하 권장)' });
        }
      }

      const newProduct = {
        id: Utilities.getUuid(),
        name: name,
        brand: (payload.brand || '').trim().slice(0, 120),
        category: category,
        status: status,
        expiry: expiry,
        opened: opened,
        months: months,
        memo: (payload.memo || '').trim().slice(0, 10000),
        photo: photo,
        createdAt: nowStr,
        updatedAt: nowStr
      };

      data.products.push(newProduct);
      data.syncedAt = nowStr;
      saveData(data);

      const d = calculateDeadline(newProduct, todayStr);
      return jsonResponse({
        success: true,
        action: 'add',
        message: `‘${name}’ 제품을 화장대에 등록했어요.`,
        product: formatProductOutput(newProduct, d)
      });
    }

    // ------------------------------------------------------------------------
    // (2) 제품 수정 (update)
    // ------------------------------------------------------------------------
    if (action === 'update') {
      const id = (payload.id || '').trim();
      if (!id) return jsonResponse({ success: false, error: '수정(update)할 제품의 ID(id)는 필수입니다.' });

      const product = data.products.find(p => p.id === id);
      if (!product) return jsonResponse({ success: false, error: `ID가 "${id}"인 제품을 찾지 못했어요.` });

      if (payload.name !== undefined) {
        const name = String(payload.name).trim();
        if (!name) return jsonResponse({ success: false, error: '제품명(name)은 비워둘 수 없습니다.' });
        product.name = name.slice(0, 120);
      }
      if (payload.brand !== undefined) product.brand = String(payload.brand).trim().slice(0, 120);
      if (payload.category !== undefined) {
        if (!VALID_CATEGORIES.includes(payload.category)) {
          return jsonResponse({ success: false, error: `유효하지 않은 카테고리입니다: "${payload.category}". 지원: ${VALID_CATEGORIES.join(', ')}` });
        }
        product.category = payload.category;
      }
      if (payload.status !== undefined) {
        if (!VALID_STATUSES.includes(payload.status)) {
          return jsonResponse({ success: false, error: `유효하지 않은 상태입니다: "${payload.status}". 지원: ${VALID_STATUSES.join(', ')}` });
        }
        product.status = payload.status;
      }
      if (payload.expiry !== undefined) {
        const exp = String(payload.expiry).trim();
        if (exp && !isValidDateString(exp)) return jsonResponse({ success: false, error: `유효하지 않은 사용기한: "${exp}"` });
        product.expiry = exp;
      }
      if (payload.opened !== undefined) {
        const op = String(payload.opened).trim();
        if (op && !isValidDateString(op)) return jsonResponse({ success: false, error: `유효하지 않은 개봉일: "${op}"` });
        product.opened = op;
      }
      if (payload.months !== undefined) {
        if (payload.months === null || payload.months === '') product.months = null;
        else {
          const m = parseInt(payload.months, 10);
          if (isNaN(m) || m < 1 || m > 120) return jsonResponse({ success: false, error: '개봉 후 기간은 1~120 사이 정수여야 합니다.' });
          product.months = m;
        }
      }
      if (payload.memo !== undefined) product.memo = String(payload.memo).trim().slice(0, 10000);

      if (payload.photo !== undefined) {
        let photo = String(payload.photo || '').trim();
        if (photo) {
          if (!photo.startsWith('data:image/')) {
            return jsonResponse({ success: false, error: '사진(photo)은 data:image/ 형식의 base64 데이터만 허용됩니다.' });
          }
          if (photo.length > 2800000) {
            return jsonResponse({ success: false, error: '사진 용량이 너무 큽니다. (최대 2MB 이하 권장)' });
          }
          product.photo = photo;
        } else {
          product.photo = '';
        }
      }

      product.updatedAt = nowStr;
      data.syncedAt = nowStr;
      saveData(data);

      const d = calculateDeadline(product, todayStr);
      return jsonResponse({
        success: true,
        action: 'update',
        message: `‘${product.name}’ 정보를 수정했어요.`,
        product: formatProductOutput(product, d)
      });
    }

    // ------------------------------------------------------------------------
    // (3) 제품 개봉 (open)
    // ------------------------------------------------------------------------
    if (action === 'open') {
      const id = (payload.id || '').trim();
      const name = (payload.name || '').trim();
      if (!id && !name) return jsonResponse({ success: false, error: '개봉할 제품의 ID(id) 또는 제품명(name)이 필요합니다.' });

      const target = resolveTargetProduct(data.products, id, name, true);
      if (!target.success) return jsonResponse(target);

      const found = target.product;
      const openedDate = (payload.opened || todayStr).trim();
      if (!isValidDateString(openedDate)) {
        return jsonResponse({ success: false, error: `유효하지 않은 개봉일 날짜 형식입니다: "${openedDate}"` });
      }

      found.status = '사용 중';
      found.opened = openedDate;
      found.updatedAt = nowStr;
      data.syncedAt = nowStr;
      saveData(data);

      const d = calculateDeadline(found, todayStr);
      return jsonResponse({
        success: true,
        action: 'open',
        message: `‘${found.name}’을(를) 사용 중(개봉일: ${openedDate})으로 기록했어요.`,
        product: formatProductOutput(found, d)
      });
    }

    // ------------------------------------------------------------------------
    // (4) 사용 완료 처리 (finish)
    // ------------------------------------------------------------------------
    if (action === 'finish') {
      const id = (payload.id || '').trim();
      const name = (payload.name || '').trim();
      if (!id && !name) return jsonResponse({ success: false, error: '완료할 제품의 ID(id) 또는 정확한 제품명(name)이 필요합니다.' });

      const target = resolveTargetProduct(data.products, id, name, false); // 정확 일치만
      if (!target.success) return jsonResponse(target);

      const found = target.product;
      found.status = '사용 완료';
      found.updatedAt = nowStr;
      data.syncedAt = nowStr;
      saveData(data);

      const d = calculateDeadline(found, todayStr);
      return jsonResponse({
        success: true,
        action: 'finish',
        message: `‘${found.name}’ 사용 완료를 기록했어요.`,
        product: formatProductOutput(found, d)
      });
    }

    // ------------------------------------------------------------------------
    // (5) 제품 폐기 처리 (discard)
    // ------------------------------------------------------------------------
    if (action === 'discard') {
      const id = (payload.id || '').trim();
      const name = (payload.name || '').trim();
      if (!id && !name) return jsonResponse({ success: false, error: '폐기할 제품의 ID(id) 또는 정확한 제품명(name)이 필요합니다.' });

      const target = resolveTargetProduct(data.products, id, name, false); // 정확 일치만
      if (!target.success) return jsonResponse(target);

      const found = target.product;
      found.status = '폐기';
      found.updatedAt = nowStr;
      data.syncedAt = nowStr;
      saveData(data);

      const d = calculateDeadline(found, todayStr);
      return jsonResponse({
        success: true,
        action: 'discard',
        message: `‘${found.name}’ 제품을 폐기 처리했어요.`,
        product: formatProductOutput(found, d)
      });
    }

    // ------------------------------------------------------------------------
    // (6) 제품 삭제 (delete - 오삭제 방지를 위해 ID 필수)
    // ------------------------------------------------------------------------
    if (action === 'delete') {
      const id = (payload.id || '').trim();
      if (!id) {
        return jsonResponse({
          success: false,
          error: '삭제(delete)는 데이터 손실 방지를 위해 제품 ID(id)가 필수입니다. 이름으로의 삭제는 허용되지 않습니다.'
        });
      }

      const index = data.products.findIndex(p => p.id === id);
      if (index === -1) {
        return jsonResponse({ success: false, error: `ID가 "${id}"인 제품을 찾지 못했어요.` });
      }

      const deleted = data.products.splice(index, 1)[0];
      data.deletedIds = data.deletedIds || {};
      data.deletedIds[deleted.id] = nowStr;
      data.syncedAt = nowStr;
      saveData(data);

      return jsonResponse({
        success: true,
        action: 'delete',
        message: `‘${deleted.name}’ 제품을 화장대에서 완전히 삭제했어요.`,
        deletedId: deleted.id
      });
    }

    // ------------------------------------------------------------------------
    // (7) 웹/모바일 앱과의 실시간 양방향 동기화 (sync)
    // ------------------------------------------------------------------------
    if (action === 'sync') {
      const rawClientProducts = Array.isArray(payload.products) ? payload.products : [];
      const clientProducts = rawClientProducts.map(sanitizeProduct).filter(Boolean);
      const clientDeleted = (typeof payload.deletedIds === 'object' && payload.deletedIds) ? payload.deletedIds : {};
      const readOnlyPull = Boolean(payload.readOnlyPull);

      // tombstones 병합
      const allDeleted = { ...(data.deletedIds || {}), ...clientDeleted };
      data.deletedIds = allDeleted;

      let merged = mergeProductsList(clientProducts, data.products, allDeleted);

      if (!readOnlyPull) {
        data.products = merged;
        data.syncedAt = nowStr;
        saveData(data);
      }

      return jsonResponse({
        success: true,
        action: 'sync',
        readOnly: readOnlyPull,
        syncedAt: data.syncedAt,
        count: merged.length,
        products: merged
      });
    }

    return jsonResponse({
      success: false,
      error: `알 수 없는 POST action입니다: "${action}". (지원: add, update, open, finish, discard, delete, sync)`
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// --------------------------------------------------------------------------
// 검색 및 모호성 해결 (Exact vs Partial Match Resolver)
// --------------------------------------------------------------------------

function resolveTargetProduct(products, id, name, allowPartialIfSingle) {
  // 1. ID가 주어지면 ID로 직접 검색
  if (id) {
    const p = products.find(x => x.id === id);
    if (!p) return { success: false, error: `ID가 "${id}"인 제품을 찾지 못했어요.` };
    return { success: true, product: p };
  }

  const query = name.toLowerCase().trim();

  // 2. 정확 일치 검색 (대소문자 무시)
  const exactMatches = products.filter(x => x.name.toLowerCase().trim() === query && !['사용 완료', '폐기'].includes(x.status));
  if (exactMatches.length === 1) {
    return { success: true, product: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    return {
      success: false,
      error: `‘${name}’과(와) 정확히 일치하는 제품이 ${exactMatches.length}개 있습니다. 고유 ID(id)를 지정해 주세요.`,
      candidates: exactMatches.map(p => ({ id: p.id, name: p.name, brand: p.brand, status: p.status }))
    };
  }

  // 3. 부분 일치 검색 허용 시 (open 전용)
  if (allowPartialIfSingle) {
    const partialMatches = products.filter(x => x.name.toLowerCase().includes(query) && !['사용 완료', '폐기'].includes(x.status));
    if (partialMatches.length === 1) {
      return { success: true, product: partialMatches[0] };
    }
    if (partialMatches.length > 1) {
      return {
        success: false,
        error: `‘${name}’ 검색어에 해당하는 제품이 여러 개 검색되었습니다. 더 구체적인 제품명 또는 고유 ID(id)를 지정해 주세요.`,
        candidates: partialMatches.map(p => ({ id: p.id, name: p.name, brand: p.brand, status: p.status }))
      };
    }
  }

  return { success: false, error: `‘${name}’에 해당하는 활성 제품을 찾지 못했어요.` };
}

// --------------------------------------------------------------------------
// 구글 드라이브 파일 입출력
// --------------------------------------------------------------------------

function getFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function getOrCreateData() {
  const folder = getFolder();
  const files = folder.getFilesByName(FILE_NAME);
  if (files.hasNext()) {
    const file = files.next();
    const content = file.getBlob().getDataAsString('UTF-8');
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.products)) return parsed;
    } catch (e) {}
  }

  // 폴더에 없으면 내 드라이브 전체에서 검색
  const rootFiles = DriveApp.getFilesByName(FILE_NAME);
  if (rootFiles.hasNext()) {
    const file = rootFiles.next();
    const content = file.getBlob().getDataAsString('UTF-8');
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.products)) return parsed;
    } catch (e) {}
  }

  return {
    app: 'beauty-deadline',
    version: 2,
    syncedAt: null,
    deletedIds: {},
    products: []
  };
}

function sanitizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 120);
  if (!name) return null;

  const id = (typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim() : Utilities.getUuid();
  const brand = String(raw.brand || '').trim().slice(0, 120);
  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : '기타';
  const status = VALID_STATUSES.includes(raw.status) ? raw.status : '미개봉';
  const expiry = (raw.expiry && isValidDateString(raw.expiry)) ? String(raw.expiry).trim() : '';
  const opened = (raw.opened && isValidDateString(raw.opened)) ? String(raw.opened).trim() : '';

  let months = null;
  if (raw.months !== undefined && raw.months !== null && raw.months !== '') {
    const m = parseInt(raw.months, 10);
    if (!isNaN(m) && m >= 1 && m <= 120) months = m;
  }

  let photo = '';
  if (typeof raw.photo === 'string' && raw.photo.startsWith('data:image/') && raw.photo.length <= 2800000) {
    photo = raw.photo;
  }

  const memo = String(raw.memo || '').trim().slice(0, 10000);
  const nowStr = new Date().toISOString();
  const createdAt = (typeof raw.createdAt === 'string' && !isNaN(Date.parse(raw.createdAt))) ? raw.createdAt : nowStr;
  const updatedAt = (typeof raw.updatedAt === 'string' && !isNaN(Date.parse(raw.updatedAt))) ? raw.updatedAt : nowStr;

  return {
    id,
    name,
    brand,
    category,
    status,
    expiry,
    opened,
    months,
    memo,
    photo,
    createdAt,
    updatedAt
  };
}

function saveData(data) {
  const folder = getFolder();
  const jsonString = JSON.stringify(data, null, 2);
  const files = folder.getFilesByName(FILE_NAME);
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(jsonString);
  } else {
    folder.createFile(FILE_NAME, jsonString, MimeType.PLAIN_TEXT);
  }
}

function mergeProductsList(localList, remoteList, deletedMap) {
  const map = new Map();
  for (const item of remoteList || []) {
    if (!item || !item.id) continue;
    const deletedTime = deletedMap[item.id];
    if (deletedTime && new Date(item.updatedAt || 0) <= new Date(deletedTime)) continue;
    map.set(item.id, item);
  }
  for (const local of localList || []) {
    if (!local || !local.id) continue;
    const deletedTime = deletedMap[local.id];
    if (deletedTime && new Date(local.updatedAt || 0) <= new Date(deletedTime)) continue;
    const remote = map.get(local.id);
    if (!remote || new Date(local.updatedAt || 0) >= new Date(remote.updatedAt || 0)) {
      map.set(local.id, local);
    }
  }
  return Array.from(map.values());
}

// --------------------------------------------------------------------------
// 날짜 검증 및 유통기한 계산 엔진 (dates.js 100% 동일 구현)
// --------------------------------------------------------------------------

function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && parseInt(s.slice(0, 4), 10) >= 1900;
}

function addMonthsToDate(dateStr, months) {
  if (!isValidDateString(dateStr) || !Number.isInteger(months) || months < 1 || months > 120) return null;
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  // UTC 기반 월말 정규화
  const targetYearMonth = new Date(Date.UTC(y, m - 1 + months, 1));
  const targetY = targetYearMonth.getUTCFullYear();
  const targetM = targetYearMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();

  const finalD = Math.min(d, lastDay);
  return `${targetY}-${String(targetM).padStart(2, '0')}-${String(finalD).padStart(2, '0')}`;
}

function getTodayString() {
  const d = new Date();
  const kst = new Date(d.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().slice(0, 10);
}

function calculateDeadline(p, todayStr) {
  todayStr = todayStr || getTodayString();
  const list = [];

  if (isValidDateString(p.expiry)) {
    list.push({ date: p.expiry, reason: '표시된 사용기한' });
  }

  const isOpened = p.status && p.status !== '미개봉';
  const hasOpenedDate = isValidDateString(p.opened);
  const hasMonths = Boolean(p.months && Number.isInteger(Number(p.months)) && Number(p.months) >= 1 && Number(p.months) <= 120);

  if (isOpened && hasOpenedDate && hasMonths) {
    const calcDate = addMonthsToDate(p.opened, Number(p.months));
    if (calcDate) {
      list.push({ date: calcDate, reason: `개봉일 ${p.opened} + ${p.months}개월` });
    }
  }

  const partialNote = p.status === '사용 중' ? (
    hasOpenedDate && !hasMonths ? '개봉 후 사용기간 미입력(표시 기한만 반영)' :
    !hasOpenedDate && hasMonths ? '개봉일 미입력(표시 기한만 반영)' : ''
  ) : '';

  list.sort((a, b) => a.date.localeCompare(b.date));

  if (!list.length) {
    const emptyReason = p.status === '사용 중' && hasOpenedDate && !hasMonths ? '개봉 후 사용기간(개월) 또는 표시된 사용기한을 입력하세요.' :
      p.status === '사용 중' && !hasOpenedDate && hasMonths ? '개봉일 또는 표시된 사용기한을 입력하세요.' :
      '표시된 사용기한 또는 개봉일과 개봉 후 사용기간을 입력하세요.';
    return { date: null, days: null, label: '날짜 확인 필요', reason: emptyReason, partial: Boolean(partialNote) };
  }

  const first = list[0];
  const diffTime = new Date(first.date + 'T00:00:00Z') - new Date(todayStr + 'T00:00:00Z');
  const days = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const baseReason = list.map(x => `${x.reason} → ${x.date}`).join(' / ') + (list.length > 1 ? ' · 빠른 날짜 적용' : '');

  const label = days < 0 ? '기한 경과' : days <= 30 ? '30일 이내' : '여유 있어요';
  return {
    date: first.date,
    days: days,
    label: label,
    reason: baseReason + (partialNote ? ` · ${partialNote}` : ''),
    partial: Boolean(partialNote)
  };
}

function formatProductOutput(p, d) {
  d = d || calculateDeadline(p);
  return {
    id: p.id,
    name: p.name,
    brand: p.brand || '',
    category: p.category || '기타',
    status: p.status || '미개봉',
    expiry: p.expiry || '',
    opened: p.opened || '',
    months: p.months || null,
    memo: p.memo || '',
    photo: p.photo || '',
    targetDate: d.date,
    daysLeft: d.days,
    label: d.label,
    reason: d.reason,
    partial: Boolean(d.partial),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
