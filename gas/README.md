# 뷰티기한 (Beauty Deadline) - Cloud & Chatbot API (v2)

MUSE, ChatGPT, 슬랙/텔레그램 봇, 또는 뷰티기한 웹/모바일 앱에서 호출할 수 있는 구글 드라이브 기반 통합 백엔드 API 명세서입니다.

---

## 1. 개요 및 보안

* **구글 계정만으로 100% 무료 (신용카드 불필요)**: Google Apps Script(GAS)를 통해 서버리스로 구동됩니다.
* **내 구글 드라이브와 완전 연동**: 모든 데이터는 내 구글 드라이브의 `뷰티기한/beauty-deadline-data.json`에 저장됩니다.
* **보안 토큰 인증 (필수)**: 모든 요청(GET/POST)에 `token`이 포함되어야 합니다.
  * 기본 토큰: `beauty-secret-2026` (또는 Apps Script의 `스크립트 속성`에서 `API_TOKEN`으로 변경 가능)
* **동시성 잠금 (LockService)**: 챗봇과 웹앱이 동시에 저장해도 데이터 유실이 발생하지 않도록 10초 스크립트 락을 사용합니다.
* **오삭제 방지 및 모호성 제어**: `delete`는 고유 `id`가 필수이며, `open`/`finish`/`discard` 시 이름이 중복되거나 모호하면 후보 목록(`candidates`)과 함께 에러를 반환합니다.

---

## 2. API 엔드포인트 명세

### 1) 상태 확인 (`GET ?action=ping`)
```http
GET https://script.google.com/macros/s/.../exec?action=ping&token=beauty-secret-2026
```
**응답:**
```json
{
  "success": true,
  "action": "ping",
  "app": "beauty-deadline-api",
  "version": 2,
  "now": "2026-11-11T06:00:00.000Z"
}
```

---

### 2) 전체 목록 조회 (`GET ?action=list`)
```http
GET https://script.google.com/macros/s/.../exec?action=list&token=beauty-secret-2026
```
**응답:**
```json
{
  "success": true,
  "action": "list",
  "summary": { "total": 3, "expired": 0, "soon": 1, "unknown": 0 },
  "syncedAt": "2026-11-11T06:00:00.000Z",
  "products": [
    {
      "id": "uuid-...",
      "name": "자작나무 수분크림",
      "brand": "라운드랩",
      "category": "스킨케어",
      "status": "사용 중",
      "expiry": "2027-12-31",
      "opened": "2026-11-11",
      "months": 6,
      "memo": "촉촉한 데일리 크림",
      "targetDate": "2027-05-11",
      "daysLeft": 181,
      "label": "여유 있어요",
      "reason": "개봉 후 6개월 기준 (2027-05-11)이 표시 기한(2027-12-31)보다 빨라요",
      "updatedAt": "2026-11-11T06:00:00.000Z"
    }
  ]
}
```

---

### 3) 기한 임박 제품 조회 (`GET ?action=expiring`)
30일 이내 또는 이미 기한이 지난 제품만 정렬하여 반환합니다:
```http
GET https://script.google.com/macros/s/.../exec?action=expiring&token=beauty-secret-2026
```
**응답:**
```json
{
  "success": true,
  "action": "expiring",
  "count": 1,
  "items": [
    {
      "id": "uuid-...",
      "name": "데일리 선크림",
      "brand": "이니스프리",
      "category": "선케어",
      "status": "사용 중",
      "targetDate": "2026-11-25",
      "daysLeft": 14,
      "label": "30일 이내",
      "reason": "용기에 표시된 사용기한"
    }
  ]
}
```

---

### 4) 제품 등록 (`POST / action: "add"`)
카테고리(`스킨케어`, `메이크업`, `선케어`, `클렌징`, `헤어·바디`, `향수`, `기타`)와 날짜 형식을 엄격히 검증합니다:
```json
{
  "token": "beauty-secret-2026",
  "action": "add",
  "name": "자작나무 수분크림",
  "brand": "라운드랩",
  "category": "스킨케어",
  "expiry": "2027-12-31",
  "opened": "2026-11-11",
  "months": 6,
  "memo": "촉촉한 데일리 크림"
}
```
**응답:**
```json
{
  "success": true,
  "action": "add",
  "message": "‘자작나무 수분크림’ 제품을 화장대에 등록했어요.",
  "product": {
    "id": "uuid-...",
    "name": "자작나무 수분크림",
    "targetDate": "2027-05-11",
    "daysLeft": 181,
    "label": "여유 있어요",
    "reason": "개봉 후 6개월 기준 (2027-05-11)이 표시 기한(2027-12-31)보다 빨라요"
  }
}
```

---

### 5) 제품 정보 수정 (`POST / action: "update"`)
유통기한, 브랜드, 메모, PAO 개월 수 등을 수정합니다 (ID 필수):
```json
{
  "token": "beauty-secret-2026",
  "action": "update",
  "id": "uuid-...",
  "expiry": "2028-01-31",
  "memo": "겨울철 필수 꿀템"
}
```
**응답:**
```json
{
  "success": true,
  "action": "update",
  "message": "‘자작나무 수분크림’ 정보를 수정했어요.",
  "product": { ... }
}
```

---

### 6) 제품 개봉 처리 (`POST / action: "open"`)
제품명 또는 ID로 검색하여 오늘 또는 지정일자로 개봉 처리합니다:
```json
{
  "token": "beauty-secret-2026",
  "action": "open",
  "name": "수분크림",
  "opened": "2026-11-11"
}
```
* 만약 이름이 모호하거나(2개 이상 일치) 검색되지 않으면:
  ```json
  {
    "success": false,
    "error": "‘수분크림’ 검색어에 해당하는 제품이 여러 개 검색되었습니다. 더 구체적인 제품명 또는 고유 ID(id)를 지정해 주세요.",
    "candidates": [
      { "id": "1", "name": "자작나무 수분크림", "brand": "라운드랩" },
      { "id": "2", "name": "진정 수분크림", "brand": "닥터지" }
    ]
  }
  ```

---

### 7) 사용 완료 처리 (`POST / action: "finish"`)
```json
{
  "token": "beauty-secret-2026",
  "action": "finish",
  "id": "uuid-..."
}
```

---

### 8) 제품 폐기 처리 (`POST / action: "discard"`)
```json
{
  "token": "beauty-secret-2026",
  "action": "discard",
  "id": "uuid-..."
}
```

---

### 9) 제품 완전 삭제 (`POST / action: "delete"`)
데이터 손실 방지를 위해 **고유 ID(`id`)가 필수**입니다:
```json
{
  "token": "beauty-secret-2026",
  "action": "delete",
  "id": "uuid-..."
}
```

---

### 10) 웹/모바일 앱 양방향 동기화 (`POST / action: "sync"`)
뷰티기한 웹앱에서 변경된 제품 목록과 삭제 이력(tombstones)을 보내면 타임스탬프 기반으로 병합하여 반환합니다:
```json
{
  "token": "beauty-secret-2026",
  "action": "sync",
  "readOnlyPull": false,
  "products": [ ... ],
  "deletedIds": { "del-id": "2026-11-11T..." }
}
```

---

## 3. MUSE(대화형 AI)를 위한 도구 명세 (Function Calling Schema)

```json
[
  {
    "name": "add_cosmetic",
    "description": "화장품을 새로 등록합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "token": { "type": "string", "default": "beauty-secret-2026" },
        "action": { "type": "string", "default": "add" },
        "name": { "type": "string", "description": "제품명 (필수)" },
        "brand": { "type": "string", "description": "브랜드명" },
        "category": { "type": "string", "enum": ["스킨케어", "메이크업", "선케어", "클렌징", "헤어·바디", "향수", "기타"] },
        "expiry": { "type": "string", "description": "표시된 사용기한 (YYYY-MM-DD)" },
        "opened": { "type": "string", "description": "개봉일 (YYYY-MM-DD)" },
        "months": { "type": "integer", "description": "개봉 후 사용 권장 개월수 (1~120)" },
        "memo": { "type": "string", "description": "메모" }
      },
      "required": ["token", "action", "name"]
    }
  },
  {
    "name": "open_cosmetic",
    "description": "화장품을 오늘 또는 특정 일자에 개봉했음을 기록합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "token": { "type": "string", "default": "beauty-secret-2026" },
        "action": { "type": "string", "default": "open" },
        "name": { "type": "string", "description": "제품명 (예: 수분크림)" },
        "opened": { "type": "string", "description": "개봉일자 (YYYY-MM-DD, 기본값 오늘)" }
      },
      "required": ["token", "action", "name"]
    }
  },
  {
    "name": "update_cosmetic",
    "description": "화장품의 유통기한, 메모, 개봉 후 기간 등을 수정합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "token": { "type": "string", "default": "beauty-secret-2026" },
        "action": { "type": "string", "default": "update" },
        "id": { "type": "string", "description": "수정할 제품의 고유 ID (필수)" },
        "expiry": { "type": "string", "description": "변경할 사용기한 (YYYY-MM-DD)" },
        "months": { "type": "integer", "description": "변경할 개봉 후 권장 개월수" },
        "memo": { "type": "string", "description": "추가 또는 변경할 메모" }
      },
      "required": ["token", "action", "id"]
    }
  },
  {
    "name": "discard_cosmetic",
    "description": "화장품을 버렸거나 폐기했음을 기록합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "token": { "type": "string", "default": "beauty-secret-2026" },
        "action": { "type": "string", "default": "discard" },
        "id": { "type": "string", "description": "폐기할 제품의 고유 ID 또는 정확한 제품명" }
      },
      "required": ["token", "action", "id"]
    }
  },
  {
    "name": "get_expiring_cosmetics",
    "description": "기한이 30일 이내로 임박했거나 이미 지난 화장품 목록을 조회합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "token": { "type": "string", "default": "beauty-secret-2026" },
        "action": { "type": "string", "default": "expiring" }
      },
      "required": ["token", "action"]
    }
  }
]
```
