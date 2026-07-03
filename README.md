# note_mcp

로컬 레포지토리의 markdown을 **단일 진실원(Single Source of Truth)** 으로 삼아, 일본 콘텐츠 플랫폼 [note](https://note.com) 블로그와 동기화하는 MCP 서버.

> Claude가 로컬 markdown을 잘 다루니까, markdown을 정답으로 두고 note로 밀어넣자는 것이 핵심 아이디어.

## 목표

- 레포 안의 `.md` 파일들이 항상 정답.
- 변경된 markdown을 note 블로그로 push.
- Claude(MCP 클라이언트)에서 도구로 호출해 동기화.

## 결정된 방향

| 항목 | 선택 | 비고 |
|------|------|------|
| 런타임 | **TypeScript** | 공식 MCP SDK 지원이 가장 좋고, markdown→HTML 변환 생태계(remark/rehype)가 풍부 |
| 동기화 방향 | **md → note 단방향 push** | 로컬 markdown이 항상 정답. 충돌 없음, 단순/안전 |
| 발행 정책 | **초안(draft)까지만** | md→note 변환 결과를 note 초안으로만 저장. 최종 발행은 사람이 note에서 눈으로 확인 후 클릭. 비공식 API 리스크 최소화 |

## note API 현황 (중요)

note는 **공식 API가 없다.** 브라우저 통신을 역분석한 **비공식 엔드포인트**만 존재한다.

- Base URL: `https://note.com/api`
- 초안 저장: `POST /api/v3/drafts` (또는 `POST /api/v1/text_notes/draft_save`)
- 발행: `POST /api/v2/notes/{note_key}/publish`
- 이미지 업로드: `POST /api/v1/upload_image`
- **인증**: 공식 OAuth 없음. 브라우저 로그인 **세션 쿠키**를 넣어줘야 함 (만료 시 갱신 필요).

### ⚠️ 기술적 함정 2가지

1. **note 본문은 markdown이 아니라 note 자체 리치텍스트(HTML 구조)** 다.
   → 핵심 난이도는 단순 업로드가 아니라 **markdown → note HTML 변환**.
   → 임베드/이미지/표 등은 일부 손실·제약 가능.
2. **비공식 API는 예고 없이 깨질 수 있다.**
   → 초안 우선 + 상태코드 체크 + 실패 시 수동 fallback 설계 필요.

## 참고: 공식 자원 부재

- note 공식 MCP ❌
- note 공식 공개 GitHub org ❌ (기술팀은 주로 Qiita `pieceofcake` / note 자체 기술 블로그에서 활동)
- note 공식 공개 API 문서 ❌ (비공식 내부 API만 존재)

→ 결국 비공식 API를 직접 감싸는 방식이 현실적인 유일한 선택지.

## 동기화된 글 (인덱스)

> 파일 ↔ note 주소 매핑. 정답은 각 md의 frontmatter(`note_key`/`note_id`)이며, 아래 표는 사람이 보기 위한 요약. `note_list_local` 도구로 재생성 가능.

| 파일 | 제목 | note 주소 | 상태 |
|------|------|-----------|------|
| [content/2026-07-02.md](content/2026-07-02.md) | 07.02 | https://note.com/jovid_18/n/n626cec6b9e15 | published |

## 다음 할 일 (TODO)

- [ ] note 비공식 write API 실제 요청 형식 확정 (인증 헤더, XSRF 토큰, 바디 구조)
- [ ] markdown frontmatter 스키마 설계 (note_key, title, status, 태그 등)
- [ ] markdown → note HTML 변환기
- [ ] 세션 쿠키 인증 처리 (.env)
- [ ] MCP 서버 골격 (TypeScript, 공식 SDK)
- [ ] MCP 도구: 로컬 글 목록 / 단일 글 push / 전체 sync / 상태 확인
