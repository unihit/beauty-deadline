# 뷰티기한 (Beauty Deadline) - Chatbot & Apps Script API

MUSE, ChatGPT, 슬랙/텔레그램 봇 등 대화형 AI가 사용자의 화장대를 음성 또는 대화로 조회·등록·수정할 수 있도록 제공되는 무료 서버리스 API입니다.

---

## 1. 개요 및 특징

* **구글 계정만으로 100% 무료 (신용카드 등록 전혀 불필요)**: Google Apps Script(GAS)를 활용하여 상시 무료로 호스팅됩니다.
* **내 구글 드라이브와 완전 연동**: 모든 데이터는 내 구글 드라이브의 `뷰티기한/beauty-deadline-data.json`에 안전하게 저장됩니다.
* **뷰티기한 앱과 실시간 동기화**: 챗봇이 제품을 등록하거나 개봉일을 기록하면, 스마트폰이나 PC에서 뷰티기한 웹앱을 켤 때 자동으로 반영됩니다.

---

## 2. API 엔드포인트 명세

### (1) 제품 등록 (`POST` / action: `add`)
챗봇에게 *"오늘 산 이니스프리 선크림 등록해줘, 2027년 5월까지야"*라고 했을 때 호출:
```json
{
  "action": "add",
  "name": "데일리 선크림",
  "brand": "이니스프리",
  "category": "선케어",
  "expiry": "2027-05-31",
  "opened": "2026-11-11",
  "months": 12,
  "memo": "선물받은 제품"
}
```
**응답:**
```json
{
  "success": true,
  "message": "‘데일리 선크림’ 제품을 화장대에 등록했어요.",
  "product": {
    "id": "uuid-...",
    "name": "데일리 선크림",
    "targetDate": "2027-05-31",
    "daysLeft": 170,
    "label": "여유 있어요",
    "reason": "용기에 표시된 사용기한"
  }
}
```

---

### (2) 제품 개봉 처리 (`POST` / action: `open`)
챗봇에게 *"수분크림 오늘 개봉했어"*라고 했을 때 호출 (제품명 검색 및 개봉일 자동 기록, 기한 자동 재계산):
```json
{
  "action": "open",
  "name": "수분크림",
  "opened": "2026-11-11"
}
```
**응답:**
```json
{
  "success": true,
  "message": "‘자작나무 수분크림’을(를) 사용 중(개봉일: 2026-11-11)으로 기록했어요.",
  "product": {
    "name": "자작나무 수분크림",
    "status": "사용 중",
    "opened": "2026-11-11",
    "targetDate": "2027-05-11",
    "daysLeft": 181,
    "label": "여유 있어요",
    "reason": "개봉 후 6개월 기준 (2027-05-11)이 표시 기한(2027-12-31)보다 빨라요"
  }
}
```

---

### (3) 기한 임박 제품 조회 (`GET` / `?action=expiring`)
챗봇에게 *"빨리 써야 하는 화장품 뭐 있어?"*라고 했을 때 호출 (30일 이내 또는 지난 제품 반환):
```http
GET https://script.google.com/macros/s/.../exec?action=expiring
```
**응답:**
```json
{
  "success": true,
  "count": 2,
  "items": [
    {
      "name": "선크림",
      "targetDate": "2026-11-06",
      "daysLeft": -5,
      "label": "기한 경과",
      "reason": "용기에 표시된 사용기한"
    },
    {
      "name": "수분 크림",
      "targetDate": "2026-11-25",
      "daysLeft": 14,
      "label": "30일 이내",
      "reason": "개봉 후 6개월 기준"
    }
  ]
}
```

---

### (4) 전체 화장대 조회 (`GET` / `?action=list`)
전체 관리 중인 제품 목록과 통계(총 개수, 경과, 30일 이내 등) 반환.

---

### (5) 사용 완료 처리 (`POST` / action: `finish`)
```json
{
  "action": "finish",
  "name": "수분크림"
}
```

---

## 3. MUSE(대화형 AI)를 위한 도구 정의 (Function Calling Schema)

```json
[
  {
    "name": "add_cosmetic",
    "description": "화장품을 새로 등록합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "default": "add" },
        "name": { "type": "string", "description": "제품명" },
        "brand": { "type": "string", "description": "브랜드명" },
        "category": { "type": "string", "enum": ["스킨케어", "클렌징", "선케어", "베이스메이크업", "색조", "헤어·바디", "기타"] },
        "expiry": { "type": "string", "description": "표시된 사용기한 (YYYY-MM-DD)" },
        "opened": { "type": "string", "description": "개봉일 (YYYY-MM-DD)" },
        "months": { "type": "integer", "description": "개봉 후 사용 권장 개월수" }
      },
      "required": ["action", "name"]
    }
  },
  {
    "name": "open_cosmetic",
    "description": "화장품을 오늘 또는 특정 일자에 개봉했음을 기록합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "default": "open" },
        "name": { "type": "string", "description": "제품명 또는 키워드 (예: 수분크림)" },
        "opened": { "type": "string", "description": "개봉일자 (YYYY-MM-DD, 없으면 오늘)" }
      },
      "required": ["action", "name"]
    }
  },
  {
    "name": "get_expiring_cosmetics",
    "description": "기한이 30일 이내로 임박했거나 이미 지난 화장품을 조회합니다.",
    "parameters": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "default": "expiring" }
      }
    }
  }
]
```
