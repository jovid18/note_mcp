/**
 * note 비공식 API 래퍼. 자세한 스펙은 docs/note-api.md 참고.
 * 핵심: 모든 쓰기 요청에 X-Requested-With: XMLHttpRequest 헤더 필수 (없으면 422).
 */

const API_BASE = "https://note.com/api";
const ORIGIN = "https://editor.note.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export interface CurrentUser {
  id: number;
  key: string;
  nickname: string;
  urlname: string;
  noteCount: number;
}

export interface CreatedNote {
  id: number;
  key: string;
}

export interface DraftSaveArgs {
  id: number;
  name: string;
  body: string; // note HTML
  bodyLength: number;
  index?: boolean;
  indexLocation?: string | null;
  isLeadForm?: boolean;
}

export interface NoteData {
  id: number;
  key: string;
  name: string | null;
  status: string;
  body: string | null;
  /** 발행 일시 (ISO, +09:00). 미발행이면 null */
  publishAt: string | null;
  /** 생성 일시 (ISO, +09:00) */
  createdAt: string | null;
  /** 해시태그 이름 목록 (선행 # 제거) */
  tags: string[];
}

export class NoteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "NoteApiError";
  }
}

export class NoteClient {
  constructor(private readonly sessionCookie: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Cookie: `_note_session_v5=${this.sessionCookie}`,
      "User-Agent": UA,
      Accept: "application/json",
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      "X-Requested-With": "XMLHttpRequest",
      ...extra,
    };
  }

  private async request<T = any>(
    method: string,
    path: string,
    opts: { body?: unknown; raw?: string | FormData; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = `${API_BASE}${path}`;
    const headers = this.headers(opts.headers);
    let body: string | FormData | undefined;
    if (opts.raw !== undefined) {
      body = opts.raw;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, { method, headers, body });
    const text = await res.text();

    if (!res.ok) {
      // 401/403/422 등은 보통 쿠키 만료 또는 CSRF 헤더 누락
      const hint =
        res.status === 401 || res.status === 403
          ? " (쿠키 만료 가능 — `npm run refresh-cookie` 시도)"
          : "";
      throw new NoteApiError(
        `note API ${method} ${path} → ${res.status}${hint}`,
        res.status,
        text.slice(0, 500),
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** 인증 확인 + 현재 유저 */
  async currentUser(): Promise<CurrentUser> {
    const json = await this.request<{ data: any }>("GET", "/v2/current_user");
    const d = json.data;
    return {
      id: d.id,
      key: d.key,
      nickname: d.nickname,
      urlname: d.urlname,
      noteCount: d.note_count,
    };
  }

  /** 빈 텍스트 노트 생성 → {id, key} */
  async createTextNote(): Promise<CreatedNote> {
    const json = await this.request<{ data: any }>("POST", "/v1/text_notes", {
      body: { template_key: null },
    });
    return { id: json.data.id, key: json.data.key };
  }

  /** 초안 본문 저장 */
  async draftSave(args: DraftSaveArgs): Promise<void> {
    await this.request("POST", `/v1/text_notes/draft_save?id=${args.id}`, {
      body: {
        name: args.name,
        body: args.body,
        body_length: args.bodyLength,
        index: args.index ?? false,
        index_location: args.indexLocation ?? null,
        stock_photo_image_id: null,
        separator: null,
        is_lead_form: args.isLeadForm ?? false,
      },
    });
  }

  /** 노트 조회 (초안 포함). 발행 노트는 draft=false 로 조회. */
  async getNote(key: string, opts: { draft?: boolean } = {}): Promise<NoteData> {
    const draft = opts.draft ?? true;
    const ts = Date.now();
    const json = await this.request<{ data: any }>(
      "GET",
      `/v3/notes/${key}?draft=${draft}&draft_reedit=false&ts=${ts}`,
    );
    const d = json.data;
    const tags: string[] = Array.isArray(d.hashtag_notes)
      ? d.hashtag_notes
          .map((h: any) => String(h?.hashtag?.name ?? "").replace(/^#/, "").trim())
          .filter(Boolean)
      : [];
    return {
      id: d.id,
      key: d.key,
      name: d.name,
      status: d.status,
      body: d.body,
      publishAt: d.publish_at ?? null,
      createdAt: d.created_at ?? null,
      tags,
    };
  }

  /** 초안 삭제 */
  async deleteDraft(id: number): Promise<void> {
    await this.request(
      "DELETE",
      `/v1/text_notes/draft_delete?id=${id}&only_note_draft=true`,
    );
  }

  /** 본문 이미지 업로드 → 업로드 결과(서버 응답 data). note_id 필수. */
  async uploadImage(
    noteId: number,
    data: Uint8Array,
    filename: string,
    contentType: string,
  ): Promise<any> {
    const form = new FormData();
    const blob = new Blob([data] as never, { type: contentType });
    form.append("file", blob, filename);
    form.append("note_id", String(noteId));
    const json = await this.request<{ data: any }>(
      "POST",
      "/v1/image_upload/text_note_picture",
      { raw: form },
    );
    return json.data;
  }
}

export const editUrl = (key: string) => `https://editor.note.com/notes/${key}/edit`;
