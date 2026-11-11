/**
 * 뷰티기한 (Beauty Deadline) - Chatbot & Web API for Google Apps Script
 *
 * 구글 드라이브의 '뷰티기한' 폴더 내 'beauty-deadline-data.json'과 자동 연동됩니다.
 * MUSE, ChatGPT, 슬랙/텔레그램 봇, 또는 뷰티기한 웹/모바일 앱에서 호출할 수 있습니다.
 */

const FOLDER_NAME = '뷰티기한';
const FILE_NAME = 'beauty-deadline-data.json';

// --------------------------------------------------------------------------
// HTTP 핸들러 (GET / POST)
// --------------------------------------------------------------------------

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'ping') {
      return jsonResponse({ success: true, app: 'beauty-deadline-api', version: 1, now: new Date().toISOString() });
    }

    const data = getOrCreateData();
    const activeProducts = data.products.filter(p => !['사용 완료', '폐기'].includes(p.status));

    if (action === 'expiring') {
      const todayStr = getTodayString();
      const list = activeProducts
        .map(p => ({ product: p, deadline: calculateDeadline(p, todayStr) }))
        .filter(x => x.deadline.date && x.deadline.days !== null && x.deadline.days <= 30)
        .sort((a, b) => (a.deadline.days || 0) - (b.deadline.days || 0));

      return jsonResponse({
        success: true,
        count: list.length,
        items: list.map(x => ({
          id: x.product.id,
          name: x.product.name,
          brand: x.product.brand,
          status: x.product.status,
          targetDate: x.deadline.date,
          daysLeft: x.deadline.days,
          label: x.deadline.label,
          reason: x.deadline.reason
        }))
      });
    }

    // Default: list all products with summary counts
    const todayStr = getTodayString();
    const counts = { total: activeProducts.length, expired: 0, soon: 0, unknown: 0 };
    const items = activeProducts.map(p => {
      const d = calculateDeadline(p, todayStr);
      if (!d.date) counts.unknown++;
      else if (d.days < 0) counts.expired++;
      else if (d.days <= 30) counts.soon++;
      return {
        id: p.id,
        name: p.name,
        brand: p.brand || '',
        category: p.category || '기타',
        status: p.status,
        expiry: p.expiry || '',
        opened: p.opened || '',
        months: p.months || null,
        memo: p.memo || '',
        targetDate: d.date,
        daysLeft: d.days,
        label: d.label,
        reason: d.reason,
        updatedAt: p.updatedAt
      };
    });

    return jsonResponse({
      success: true,
      summary: counts,
      syncedAt: data.syncedAt,
      products: items
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doPost(e) {
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

    const action = payload.action || 'add';
    const data = getOrCreateData();
    const todayStr = getTodayString();

    // 1. 제품 추가
    if (action === 'add') {
      const name = (payload.name || '').trim();
      if (!name) throw new Error('제품명(name)은 필수입니다.');

      const nowStr = new Date().toISOString();
      const status = payload.status || (payload.opened ? '사용 중' : '미개봉');
      const newProduct = {
        id: Utilities.getUuid(),
        name: name,
        brand: (payload.brand || '').trim(),
        category: payload.category || '스킨케어',
        status: status,
        expiry: payload.expiry || '',
        opened: payload.opened || '',
        months: payload.months ? parseInt(payload.months, 10) : null,
        memo: payload.memo || '',
        photo: payload.photo || '',
        createdAt: nowStr,
        updatedAt: nowStr
      };

      data.products.push(newProduct);
      data.syncedAt = nowStr;
      saveData(data);

      const d = calculateDeadline(newProduct, todayStr);
      return jsonResponse({
        success: true,
        message: `‘${name}’ 제품을 화장대에 등록했어요.`,
        product: {
          ...newProduct,
          targetDate: d.date,
          daysLeft: d.days,
          label: d.label,
          reason: d.reason
        }
      });
    }

    // 2. 제품 개봉
    if (action === 'open') {
      const targetQuery = (payload.name || payload.id || '').trim().toLowerCase();
      if (!targetQuery) throw new Error('개봉할 제품명(name) 또는 ID가 필요합니다.');

      const openedDate = payload.opened || todayStr;
      const found = findProduct(data.products, targetQuery);
      if (!found) throw new Error(`‘${payload.name || payload.id}’ 제품을 찾지 못했어요.`);

      found.status = '사용 중';
      found.opened = openedDate;
      found.updatedAt = new Date().toISOString();
      data.syncedAt = found.updatedAt;
      saveData(data);

      const d = calculateDeadline(found, todayStr);
      return jsonResponse({
        success: true,
        message: `‘${found.name}’을(를) 사용 중(개봉일: ${openedDate})으로 기록했어요.`,
        product: {
          ...found,
          targetDate: d.date,
          daysLeft: d.days,
          label: d.label,
          reason: d.reason
        }
      });
    }

    // 3. 사용 완료 처리
    if (action === 'finish') {
      const targetQuery = (payload.name || payload.id || '').trim().toLowerCase();
      if (!targetQuery) throw new Error('완료할 제품명(name) 또는 ID가 필요합니다.');

      const found = findProduct(data.products, targetQuery);
      if (!found) throw new Error(`‘${payload.name || payload.id}’ 제품을 찾지 못했어요.`);

      found.status = '사용 완료';
      found.updatedAt = new Date().toISOString();
      data.syncedAt = found.updatedAt;
      saveData(data);

      return jsonResponse({
        success: true,
        message: `‘${found.name}’ 사용 완료를 기록했어요.`
      });
    }

    // 4. 제품 삭제
    if (action === 'delete') {
      const targetQuery = (payload.name || payload.id || '').trim().toLowerCase();
      if (!targetQuery) throw new Error('삭제할 제품명(name) 또는 ID가 필요합니다.');

      const index = data.products.findIndex(p => p.id === targetQuery || p.name.toLowerCase().includes(targetQuery));
      if (index === -1) throw new Error(`‘${payload.name || payload.id}’ 제품을 찾지 못했어요.`);

      const deleted = data.products.splice(index, 1)[0];
      data.deletedIds = data.deletedIds || {};
      data.deletedIds[deleted.id] = new Date().toISOString();
      data.syncedAt = new Date().toISOString();
      saveData(data);

      return jsonResponse({
        success: true,
        message: `‘${deleted.name}’ 제품을 화장대에서 삭제했어요.`
      });
    }

    // 5. 웹앱과의 양방향 동기화
    if (action === 'sync') {
      const clientProducts = payload.products || [];
      const merged = mergeProductsList(clientProducts, data.products, data.deletedIds || {});
      data.products = merged;
      data.syncedAt = new Date().toISOString();
      saveData(data);

      return jsonResponse({
        success: true,
        syncedAt: data.syncedAt,
        count: merged.length,
        products: merged
      });
    }

    throw new Error(`알 수 없는 동작(action: ${action})입니다.`);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// --------------------------------------------------------------------------
// 데이터베이스 및 구글 드라이브 파일 입출력
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
    version: 1,
    syncedAt: new Date().toISOString(),
    deletedIds: {},
    products: []
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

function findProduct(products, query) {
  // 1. 정확한 ID 일치
  let p = products.find(x => x.id === query);
  if (p) return p;
  // 2. 정확한 이름 일치
  p = products.find(x => x.name.toLowerCase() === query);
  if (p) return p;
  // 3. 이름 부분 일치 (사용 중인 것 우선)
  p = products.find(x => x.name.toLowerCase().includes(query) && x.status === '사용 중');
  if (p) return p;
  // 4. 이름 부분 일치 (아무거나)
  return products.find(x => x.name.toLowerCase().includes(query));
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
// 유통기한 및 권장기간 계산 엔진
// --------------------------------------------------------------------------

function addMonthsToDate(dateStr, months) {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  const targetM = m + months;
  const targetY = y + Math.floor((targetM - 1) / 12);
  const normalizedM = ((targetM - 1) % 12) + 1;

  const maxDays = daysInMonth(targetY, normalizedM);
  const targetD = Math.min(d, maxDays);

  return `${targetY}-${String(normalizedM).padStart(2, '0')}-${String(targetD).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getTodayString() {
  const d = new Date();
  // KST (UTC+9)
  const kst = new Date(d.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().slice(0, 10);
}

function calculateDeadline(p, todayStr) {
  todayStr = todayStr || getTodayString();
  const openedDate = p.opened;
  const months = p.months;
  const expiryDate = p.expiry;

  let paoDate = null;
  if (openedDate && months && p.status === '사용 중') {
    paoDate = addMonthsToDate(openedDate, months);
  }

  let finalDate = null;
  let reason = '';

  if (paoDate && expiryDate) {
    if (paoDate <= expiryDate) {
      finalDate = paoDate;
      reason = `개봉 후 ${months}개월 기준 (${finalDate})이 표시 기한(${expiryDate})보다 빨라요`;
    } else {
      finalDate = expiryDate;
      reason = `표시 기한 (${expiryDate})이 개봉 후 권장일(${paoDate})보다 빨라요`;
    }
  } else if (paoDate) {
    finalDate = paoDate;
    reason = `개봉일 기준 ${months}개월 후`;
  } else if (expiryDate) {
    finalDate = expiryDate;
    reason = '용기에 표시된 사용기한';
  } else {
    return { date: null, days: null, label: '날짜 확인 필요', reason: '사용기한 또는 개봉일 정보 필요' };
  }

  const diffTime = new Date(finalDate + 'T00:00:00Z') - new Date(todayStr + 'T00:00:00Z');
  const days = Math.round(diffTime / (1000 * 60 * 60 * 24));

  let label = '여유 있어요';
  if (days < 0) label = '기한 경과';
  else if (days <= 30) label = '30일 이내';

  return { date: finalDate, days: days, label: label, reason: reason };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
