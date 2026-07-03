/**
 * 오케스트레이션: 로컬 markdown 파일 → note 초안 push.
 * 변환 → 이미지 업로드 → create/update → frontmatter 쓰기-백.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { NoteClient, editUrl } from "./note-client.js";
import { mdToNoteHtml, type ImageHandler } from "./md-to-note.js";
import { parseDoc, resolveTitle, writeBackFrontmatter } from "./frontmatter.js";

export interface PushResult {
  filePath: string;
  title: string;
  noteId: number;
  noteKey: string;
  editUrl: string;
  created: boolean;
  warnings: string[];
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function uidAttr(): string {
  const u = randomUUID();
  return `name="${u}" id="${u}"`;
}

/** 로컬 이미지 업로드 핸들러 생성. 외부 URL은 그대로 figure로 임베드. */
function makeImageHandler(
  client: NoteClient,
  noteId: number,
  baseDir: string,
  warnings: string[],
): ImageHandler {
  return async ({ url, alt }) => {
    const cap = alt ? `<figcaption>${alt.replace(/</g, "&lt;")}</figcaption>` : "";
    if (/^https?:\/\//i.test(url)) {
      warnings.push(`외부 이미지 URL을 그대로 임베드: ${url} (note에서 깨질 수 있음)`);
      return `<figure ${uidAttr()}><img src="${url}">${cap}</figure>`;
    }
    const abs = resolve(baseDir, url);
    if (!existsSync(abs)) {
      warnings.push(`로컬 이미지를 찾을 수 없음: ${url}`);
      return null;
    }
    const ext = extname(abs).toLowerCase();
    const ct = MIME[ext];
    if (!ct) {
      warnings.push(`지원하지 않는 이미지 형식: ${url}`);
      return null;
    }
    const data = readFileSync(abs);
    try {
      const res = await client.uploadImage(noteId, new Uint8Array(data), basename(abs), ct);
      const src = res?.url ?? res?.file_url ?? res?.image_url ?? res?.key;
      if (!src) {
        warnings.push(`이미지 업로드 응답에서 URL을 못 찾음: ${url} (응답: ${JSON.stringify(res).slice(0, 120)})`);
        return null;
      }
      return `<figure ${uidAttr()}><img src="${src}">${cap}</figure>`;
    } catch (e) {
      warnings.push(`이미지 업로드 실패(${url}): ${(e as Error).message}`);
      return null;
    }
  };
}

/** 단일 markdown 파일을 note 초안으로 push */
export async function pushFile(client: NoteClient, filePath: string): Promise<PushResult> {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`파일 없음: ${abs}`);

  const doc = parseDoc(abs);
  const title = resolveTitle(doc, abs);
  const warnings: string[] = [];

  // 이미지 업로드는 note_id가 필요하므로, 변환 전에 노트를 먼저 확보한다.
  let noteId = typeof doc.data.note_id === "number" ? doc.data.note_id : undefined;
  let noteKey = doc.data.note_key as string | undefined;
  let created = false;
  if (!noteId || !noteKey) {
    const c = await client.createTextNote();
    noteId = c.id;
    noteKey = c.key;
    created = true;
  }

  const onImage = makeImageHandler(client, noteId, dirname(abs), warnings);
  const { html, bodyLength, warnings: convWarn } = await mdToNoteHtml(doc.content, { onImage });
  warnings.push(...convWarn);

  await client.draftSave({ id: noteId, name: title, body: html, bodyLength });

  writeBackFrontmatter(abs, {
    title,
    note_id: noteId,
    note_key: noteKey,
    status: "draft",
    synced_at: new Date().toISOString(),
  });

  return {
    filePath: abs,
    title,
    noteId,
    noteKey,
    editUrl: editUrl(noteKey),
    created,
    warnings,
  };
}
