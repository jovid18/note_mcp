---
title: note_mcp 동작 테스트
tags:
  - test
  - mcp
note_id: 166477751
note_key: n9a4654fd88aa
status: draft
synced_at: '2026-06-22T05:48:28.239Z'
---

# note_mcp 동작 테스트

이건 **note_mcp** 가 로컬 markdown을 note 초안으로 *push* 하는 걸 검증하는 글이에요.

## 기능

- markdown → note HTML 변환
- `_note_session_v5` 쿠키 인증
- 초안까지만 (발행은 사람이)

1. 변환
2. 생성
3. 저장

> 로컬 markdown이 항상 정답.

```ts
const x: number = 1;
```

| 단계 | 상태 |
|------|------|
| 변환 | OK |
| 저장 | OK |

자세한 건 [note](https://note.com) 참고.

---
