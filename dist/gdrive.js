// Google Drive AppData & Google Apps Script Sync Module for beauty-deadline
// Supports Google Apps Script Cloud API (zero-config/no-OAuth-client) or direct GIS v2 OAuth

const DRIVE_FILE_NAME = 'beauty-deadline-data.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

export function getGasUrl() {
  return localStorage.getItem('beauty_gas_url') || '';
}

export function setGasUrl(url) {
  if (url) localStorage.setItem('beauty_gas_url', url.trim());
  else localStorage.removeItem('beauty_gas_url');
}

export function getGasToken() {
  return localStorage.getItem('beauty_gas_token') || 'beauty-secret-2026';
}

export function setGasToken(tok) {
  if (tok) localStorage.setItem('beauty_gas_token', tok.trim());
  else localStorage.removeItem('beauty_gas_token');
}

export function isGasConnected() {
  return Boolean(getGasUrl());
}

export function getStoredClientId() {
  return localStorage.getItem('beauty_gdrive_client_id') || '';
}

export function setStoredClientId(id) {
  if (id) localStorage.setItem('beauty_gdrive_client_id', id.trim());
  else localStorage.removeItem('beauty_gdrive_client_id');
}

export function isConnected() {
  return Boolean(isGasConnected() || (accessToken && Date.now() < tokenExpiresAt));
}

export function getSyncMeta() {
  return {
    lastSyncedAt: localStorage.getItem('beauty_last_synced_at') || null,
    accountEmail: localStorage.getItem('beauty_gdrive_email') || null,
    clientId: getStoredClientId(),
    gasUrl: getGasUrl(),
    gasToken: getGasToken(),
    provider: isGasConnected() ? 'gas' : accessToken ? 'oauth' : null
  };
}

export function recordDeletion(id) {
  if (!id) return;
  const deleted = getDeletedIds();
  deleted[id] = new Date().toISOString();
  localStorage.setItem('beauty_deleted_ids', JSON.stringify(deleted));
}

export function getDeletedIds() {
  try {
    return JSON.parse(localStorage.getItem('beauty_deleted_ids') || '{}');
  } catch {
    return {};
  }
}

// Merge local and remote products without losing additions or newer updates.
// Also respects tombstones (deleted items).
export function mergeProducts(localList, remoteList, deletedMap = getDeletedIds()) {
  const map = new Map();
  for (const item of remoteList || []) {
    if (!item || !item.id) continue;
    const deletedTime = deletedMap[item.id];
    if (deletedTime && new Date(item.updatedAt || 0) <= new Date(deletedTime)) {
      continue; // Skip items that were deleted locally after remote update
    }
    map.set(item.id, item);
  }
  for (const local of localList || []) {
    if (!local || !local.id) continue;
    const deletedTime = deletedMap[local.id];
    if (deletedTime && new Date(local.updatedAt || 0) <= new Date(deletedTime)) {
      continue;
    }
    const remote = map.get(local.id);
    if (!remote || new Date(local.updatedAt || 0) >= new Date(remote.updatedAt || 0)) {
      map.set(local.id, local);
    }
  }
  return Array.from(map.values());
}

export async function initGoogleAuth(clientId) {
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      return reject(new Error('Google Identity Services 스크립트가 로드되지 않았습니다. 인터넷 연결을 확인해 주세요.'));
    }
    const cId = clientId || getStoredClientId();
    if (!cId) {
      return reject(new Error('Google OAuth 클라이언트 ID를 먼저 입력해 주세요.'));
    }
    setStoredClientId(cId);
    try {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: cId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) {
            reject(new Error(`인증 오류: ${resp.error}`));
            return;
          }
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000 - 60000;
          resolve(accessToken);
        }
      });
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      reject(err);
    }
  });
}

export function disconnectGoogle() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
  }
  accessToken = null;
  tokenExpiresAt = 0;
  localStorage.removeItem('beauty_gdrive_email');
}

async function fetchWithAuth(url, options = {}) {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    throw new Error('구글 드라이브 인증이 만료되었습니다. 다시 연결해 주세요.');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    accessToken = null;
    throw new Error('인증이 만료되었습니다. 다시 로그인해 주세요.');
  }
  return res;
}

// Find existing sync file in appDataFolder
async function findRemoteFile() {
  const query = encodeURIComponent(`name = '${DRIVE_FILE_NAME}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error(`드라이브 조회 실패 (${res.status})`);
  const data = await res.json();
  return data.files && data.files.length ? data.files[0] : null;
}

// Download file content from Google Drive
async function downloadRemoteData(fileId) {
  const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!res.ok) throw new Error(`드라이브 데이터 다운로드 실패 (${res.status})`);
  return await res.json();
}

// Upload (create or update) data to appDataFolder
async function uploadData(fileId, payload) {
  const fileContent = JSON.stringify(payload, null, 2);
  if (!fileId) {
    // Create via multipart
    const metadata = {
      name: DRIVE_FILE_NAME,
      parents: ['appDataFolder'],
      mimeType: 'application/json'
    };
    const boundary = '-------beauty_boundary_' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const res = await fetchWithAuth('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody
    });
    if (!res.ok) throw new Error(`드라이브 파일 생성 실패 (${res.status})`);
    return await res.json();
  } else {
    // Update existing file content
    const res = await fetchWithAuth(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: fileContent
    });
    if (!res.ok) throw new Error(`드라이브 동기화 업로드 실패 (${res.status})`);
    return await res.json();
  }
}

export async function syncWithGas(localProducts, options = {}) {
  const url = getGasUrl();
  const token = getGasToken();
  if (!url) throw new Error('구글 Apps Script API URL이 설정되지 않았습니다.');

  const readOnlyPull = Boolean(options.readOnlyPull);
  const deletedIds = getDeletedIds();

  const payload = {
    token: token,
    action: 'sync',
    readOnlyPull: readOnlyPull,
    products: localProducts,
    deletedIds: deletedIds
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`동기화 서버 응답 오류 (${res.status})`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '동기화 처리에 실패했습니다.');

  const nowStr = new Date().toISOString();
  localStorage.setItem('beauty_last_synced_at', nowStr);

  return {
    mergedProducts: data.products || localProducts,
    syncedAt: nowStr,
    count: (data.products || []).length,
    readOnly: readOnlyPull
  };
}

// Sync Flow (Supports GAS Cloud API or direct GIS v2 OAuth)
export async function syncWithDrive(localProducts, options = {}) {
  if (isGasConnected()) {
    return await syncWithGas(localProducts, options);
  }

  const readOnlyPull = Boolean(options.readOnlyPull);
  const remoteMeta = await findRemoteFile();
  let merged = [...localProducts];
  let remoteData = null;

  if (remoteMeta) {
    remoteData = await downloadRemoteData(remoteMeta.id);
    if (remoteData && Array.isArray(remoteData.products)) {
      merged = mergeProducts(localProducts, remoteData.products);
    }
  }

  const nowStr = new Date().toISOString();
  localStorage.setItem('beauty_last_synced_at', nowStr);

  // In read-only pull mode (PC web viewer default):
  // Do NOT write back to Google Drive, preventing multi-device race conditions!
  if (readOnlyPull) {
    return {
      mergedProducts: merged,
      syncedAt: nowStr,
      count: merged.length,
      readOnly: true
    };
  }

  // Full 2-Way Sync: Upload the merged outcome back to Drive
  const payload = {
    app: 'beauty-deadline',
    version: 1,
    syncedAt: nowStr,
    deletedIds: getDeletedIds(),
    products: merged
  };

  await uploadData(remoteMeta ? remoteMeta.id : null, payload);

  return {
    mergedProducts: merged,
    syncedAt: nowStr,
    count: merged.length,
    readOnly: false
  };
}
