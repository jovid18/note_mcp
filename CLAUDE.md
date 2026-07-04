# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

로컬 markdown을 **단일 진실원(Single Source of Truth)** 으로 삼아, 일본 콘텐츠 플랫폼 [note](https://note.com)의 블로그 **초안(draft)** 으로 단방향 push하는 MCP 서버(TypeScript, stdio).

핵심 제약 세 가지 — 코드를 만지기 전에 반드시 알아야 함:

1. **단방향 push만.** 로컬 md → note. note → 로컬 방향 동기화 없음. 로컬 md가 항상 정답.
2. **초안까지만. 발행하지 않는다.** `draftSave`까지가 이 프로젝트의 끝. 최종 발행은 사람이 note 웹 에디터에서 직접. 발행 엔드포인트를 코드로 호출하지 말 것.
3. **note에는 공식 API가 없다.** 브라우저를 역분석한 비공식 REST 엔드포인트를 감싼다. 예고 없이 깨질 수 있으므로, 상태코드 체크 + 실패 시 수동 fallback 안내가 설계 전제. 스펙 전문은 `docs/note-api.md`에 실측 검증본으로 정리되어 있음 — API 관련 작업 전 반드시 참조.

## 명령어

```bash
npm run dev              # tsx로 MCP 서버 직접 실행 (개발용, 빌드 없이)
npm run build            # tsc → dist/ (bin: note-mcp = dist/src/server.js)
npm run status           # 세션 쿠키로 인증 상태만 빠르게 확인
npm run refresh-cookie   # Chrome에서 note 세션 쿠키 추출 → .env 갱신 (macOS 전용)
npm run pull -- <url>    # note 글 URL → content/YYYY-MM-DD.md 로 내려받기 (부트스트랩용, /note-pull 스킬이 호출)
```

테스트 러너/린터는 아직 없음. 검증은 `npm run status`(인증)와 MCP 도구 `note_preview`(변환 dry-run, 쓰기 없음)로 수동으로 함.

## 인증 (가장 자주 막히는 지점)

- 필요한 것은 쿠키 **`_note_session_v5`** 하나. `.env`의 `NOTE_SESSION_V5`에서 읽음. 만료 약 3개월.
- 쿠키 만료 시 API가 401/403 반환 → `NoteClient`가 "`npm run refresh-cookie` 시도" 힌트를 붙여줌.
- `refresh-cookie`는 Chrome Cookies SQLite(암호화)를 macOS Keychain의 "Chrome Safe Storage" 키로 복호화. **macOS 전용**이며 첫 실행 시 Keychain 권한 팝업에서 "항상 허용" 필요.
- **모든 쓰기 요청에 `X-Requested-With: XMLHttpRequest` 헤더 필수.** 없으면 Rails CSRF로 422. `NoteClient.headers()`가 항상 붙임 — 새 요청 추가 시 이 경로를 타야 함.

## 아키텍처 (data flow)

한 파일을 push할 때의 흐름이 전체 구조를 설명함. 진입점은 MCP 도구지만 실제 오케스트레이션은 `sync.ts`:

```
server.ts (MCP 도구 정의)
  └─ sync.ts  pushFile()  ← 오케스트레이터
       ├─ frontmatter.ts  parseDoc / resolveTitle       (md 파싱, 제목 결정)
       ├─ note-client.ts  createTextNote()              (note_id 먼저 확보 — 이미지 업로드에 필요)
       ├─ md-to-note.ts   mdToNoteHtml({ onImage })     (mdast → note HTML, 이미지는 콜백으로 업로드)
       ├─ note-client.ts  draftSave()                   (본문 저장)
       └─ frontmatter.ts  writeBackFrontmatter()        (note_id/note_key/synced_at를 md에 다시 씀)
```

핵심 설계 포인트:

- **이미지 업로드는 `note_id`가 있어야 하므로, 변환 이전에 빈 노트를 먼저 생성한다.** 그래서 `pushFile`은 frontmatter에 `note_id`가 없으면 `createTextNote()`로 노트를 먼저 확보한 뒤 변환에 들어감. 순서를 바꾸지 말 것.
- **frontmatter가 로컬↔note 매핑의 저장소.** push 성공 시 `note_id`(숫자, save/delete용), `note_key`(문자, URL/조회용), `status`, `synced_at`을 md 파일에 write-back. 이후 push는 이 `note_id`를 재사용해 갱신(create 아님).
- **변환기(`md-to-note.ts`)는 remark(mdast)를 직접 순회하는 커스텀 serializer.** note HTML은 일반 HTML이 아니라 제약이 있음:
  - 모든 **블록 요소에 `name`과 `id`가 동일한 UUID**로 붙어야 함 (`uid()` 헬퍼).
  - **h1 없음** → markdown h1은 h2로, h3 이상은 h3로 매핑.
  - 지원 블록: h2/h3/p/blockquote/pre>code/hr/table/ul/ol/figure. 그 외는 warning 후 건너뜀.
  - 변환 손실/미지원은 throw가 아니라 `warnings[]`로 수집해 사용자에게 노출 (부분 성공 우선).
- **`NoteClient`는 얇은 fetch 래퍼.** 엔드포인트 하나당 메서드 하나. 새 엔드포인트는 반드시 `request()`를 거쳐 공통 헤더/에러 처리를 타게 할 것.

## MCP 도구 (server.ts)

`note_status` · `note_list_local` · `note_preview`(안전한 dry-run) · `note_push` · `note_delete_draft`. 모든 도구는 `ok()`/`err()`로 감싸 성공/실패 텍스트를 반환.

## 관례

- ESM (`"type": "module"`) + NodeNext. **상대 import는 반드시 `.js` 확장자**로 쓸 것 (예: `./config.js`) — `.ts`가 아니라.
- 코드 주석·사용자 대면 메시지는 한국어, 이모지(✅/❌/⚠) 사용이 기존 스타일.
- `strict: true`. Node ≥20 (내장 `fetch`/`crypto`/`randomUUID` 사용).
