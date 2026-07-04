---
name: note-pull
description: >-
  note.com 글 URL을 받아 로컬 markdown(content/YYYY-MM-DD.md)으로 내려받는다.
  사용자가 note 링크(https://note.com/.../n/<key> 또는 editor.note.com/notes/<key>/edit)를
  주면서 "저장", "가져와", "내려받아", "로컬로", "pull" 등을 말하거나, 링크만 던질 때 사용.
---

# note-pull

note에 이미 발행/작성한 글을 URL로 받아 로컬 markdown으로 편입한다. 이 저장소의
`scripts/pull.ts`(= `npm run pull`)를 호출하는 것이 전부다 — 직접 fetch하거나 HTML을 손으로 변환하지 말 것.

> ⚠ 방향 주의: 이 프로젝트의 정상 흐름은 로컬 md → note **단방향 push**다(CLAUDE.md).
> pull은 웹 에디터에서 쓴 글을 "로컬 SSoT로 처음 편입"하는 부트스트랩 용도. 내려받은 뒤부터는
> 로컬 md가 정답이며, 수정은 로컬에서 하고 `note_push`로 되올린다.

## 절차

1. 사용자 메시지에서 note URL(또는 `n`으로 시작하는 key)을 뽑는다. `?app_launch=...` 같은
   쿼리는 붙어 있어도 됨 — 스크립트가 알아서 key를 추출한다.

2. 실행:
   ```bash
   npm run pull -- "<url>"
   ```
   - 기존 파일이 있으면 스크립트가 에러로 막는다 → 사용자에게 덮어쓸지 확인 후 `--force`.
   - 출력 경로를 바꾸려면 `--out content/<name>.md`.

3. 파일명 날짜는 스크립트가 이 우선순위로 정한다: `--date` > **글 제목의 날짜**(예: 제목 "07.03"
   → 발행연도와 합쳐 `2026-07-03`) > 발행일시 > 생성일시. 출력의 `날짜: ... (출처: ...)`를 확인하고,
   출처가 "발행일시/생성일시"인데 일기 날짜와 어긋나 보이면 사용자에게 맞는 날짜를 물어
   `--date YYYY-MM-DD`로 다시 실행한다.

4. 실행 결과(저장 경로, 제목, 날짜, 태그, `⚠ 변환 경고`)를 사용자에게 그대로 요약해 보고한다.
   경고가 있으면(임베드/미지원 블록 등) 해당 부분은 note 원문과 대조가 필요할 수 있음을 알린다.

## 예시

입력: `https://note.com/jovid_18/n/n282446e3c14f?app_launch=false`

```bash
npm run pull -- "https://note.com/jovid_18/n/n282446e3c14f?app_launch=false"
```

→ `content/2026-07-03.md` 생성. frontmatter에 `title / note_id / note_key / status / tags /
source_url / published_at / pulled_at`가 채워지고, 본문은 note HTML이 markdown으로 역변환된다.
`note_id`/`note_key`가 들어 있으므로 이후 로컬에서 고쳐 `note_push`하면 **같은 글이 갱신**된다.

## 실패 대응

- `401/403` 또는 인증 오류: 쿠키 만료. `npm run refresh-cookie` 안내(macOS 전용).
- `500`: 존재하지 않거나 접근 불가한 note key. URL을 다시 확인.
- `note key를 URL에서 찾지 못했습니다`: URL 형식이 다름 → key(`n...`)만 뽑아 전달.
