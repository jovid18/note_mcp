# note 비공식 API 스펙 (역분석 검증본)

> 2026-06-22, 실제 호출로 전부 검증함 (계정 `jovid_18`). note는 **공식 API가 없고**, 브라우저(editor.note.com, Next.js SPA)가 쓰는 내부 엔드포인트를 그대로 사용한다. **예고 없이 깨질 수 있음.**

## 인증

- 쿠키 **`_note_session_v5`** (httpOnly) 하나면 충분. Rails 세션 쿠키.
- 만료: 발급 시점 기준 약 3개월 (`Expires` 헤더 확인).
- 추출: Chrome 프로필의 `Cookies` SQLite DB에서 가져와 macOS Keychain의 `Chrome Safe Storage` 키로 복호화. (`scripts/refresh-cookie.ts`)
- `note_gql_auth_token`은 **인메모리 세션 쿠키**라 DB 파일에 안 남음 → GraphQL 안 쓰면 불필요. REST 엔드포인트는 `_note_session_v5`로 동작.

## CSRF (가장 중요한 함정)

- **모든 쓰기 요청(POST/PUT/DELETE)에 `X-Requested-With: XMLHttpRequest` 헤더 필수.**
- 없으면 `422 {"error":"Unprocessable Entity"}` (Rails CSRF 실패). XSRF-TOKEN 쿠키/헤더는 사용 안 함.

## 공통 헤더

```
Cookie: _note_session_v5=<값>
X-Requested-With: XMLHttpRequest        # 쓰기 필수
Origin: https://editor.note.com
Content-Type: application/json          # 바디 있는 경우
Accept: application/json
User-Agent: <일반 브라우저 UA>
```

- API base: `https://note.com/api`
- SPA origin: `https://editor.note.com` / 편집 URL: `https://editor.note.com/notes/{key}/edit`

## 엔드포인트

### 인증 확인 — `GET /v2/current_user`
```jsonc
// 200
{ "data": { "id": 8850245, "key": "...", "nickname": "Canary",
            "urlname": "jovid_18", "note_count": 0, "email_confirmed_flag": true } }
```

### 초안(텍스트 노트) 생성 — `POST /v1/text_notes`
```jsonc
// body
{ "template_key": null }
// 201
{ "data": { "id": 166461366, "key": "n6747ddb3a8ce", "type": "TextNote",
            "name": null, "body": null, "user_id": 8850245, "status": "" } }
```
- `id`(숫자, draft_save/delete에 사용)와 `key`(문자, 조회/편집 URL에 사용) 둘 다 반환.

### 초안 저장 — `POST /v1/text_notes/draft_save?id={id}`
쿼리: `id`(필수), `isTempSaved`(선택), `ownerUrlname`(선택).
```jsonc
// body (JSON, snake_case)
{
  "name": "제목",
  "body": "<h2 name=UUID id=UUID>...</h2><p ...>...</p>",  // note HTML
  "body_length": 123,            // 평문 길이
  "index": false,                // 목차 사용 여부
  "index_location": null,
  "stock_photo_image_id": null,
  "separator": null,
  "is_lead_form": false
}
// 201
{ "data": { "result": true, "updated_at": "..." } }
```

### 조회 — `GET /v3/notes/{key}?draft=true&draft_reedit=false&ts={ms}`
```jsonc
// 200
{ "data": { "id": ..., "key": "...", "name": "제목", "status": "draft",
            "body": "<...note HTML...>" } }
```
- 존재하지 않는/삭제된 노트 조회 시 `500 internal_server_error`.

### 삭제 — `DELETE /v1/text_notes/draft_delete?id={id}&only_note_draft=true`
```jsonc
// 200
{ "data": { "result": { "id": ..., "note_id": 166461366, "body": "...", "name": "..." } } }
```

### 이미지 업로드 (본문) — `POST /v1/image_upload/text_note_picture`
- multipart/form-data. 본문 삽입용 이미지. (대표 이미지는 `/v1/image_upload/note_eyecatch`)

### 발행 — `POST /v2/notes/{key}/...`
- **이 프로젝트는 발행하지 않는다.** 초안까지만. 발행은 사람이 note 웹에서 직접.

## note HTML 본문 스키마

- 블록 요소마다 `name`과 `id` 속성에 **동일한 UUID**가 들어감. 예:
  `<h2 name="453320e7-..." id="453320e7-...">제목</h2>`
- 지원 블록: `h2`, `h3` (**h1 없음**), `p`, `blockquote`, `pre><code`, `hr`, `table`, `figure`(+`figcaption`).
- 인라인: `strong`, `em`, `code`, `a`, `br`.
- 이미지/임베드: `<figure ... data-src=... embedded-service=... embedded-content-key=...>`.
- markdown의 h1 → note h2, h3 이상 → note h3 으로 매핑 필요.

## 알려진 매핑/제약
- markdown ≠ note HTML. 변환 시 일부 손실 가능(복잡한 임베드/중첩 등).
- 비공식 API → 상태코드 체크 + 실패 시 수동 fallback(웹 에디터) 안내.
