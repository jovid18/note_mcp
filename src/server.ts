#!/usr/bin/env node
/**
 * note_mcp MCP 서버 (stdio).
 * 로컬 markdown → note 초안 push. 발행은 하지 않음(초안까지만).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { getConfig, requireSessionCookie } from "./config.js";
import { NoteClient, editUrl } from "./note-client.js";
import { mdToNoteHtml } from "./md-to-note.js";
import { parseDoc, resolveTitle } from "./frontmatter.js";
import { pushFile } from "./sync.js";

const cfg = getConfig();
const client = () => new NoteClient(requireSessionCookie(cfg));

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (e: unknown) => ({
  content: [{ type: "text" as const, text: `❌ ${(e as Error).message}` }],
  isError: true,
});

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listMarkdown(p));
    else if (/\.md$/i.test(name)) out.push(p);
  }
  return out;
}

const server = new McpServer({ name: "note_mcp", version: "0.1.0" });

server.tool(
  "note_status",
  "note 로그인 상태(세션 쿠키 유효성)와 현재 계정을 확인한다.",
  {},
  async () => {
    try {
      const u = await client().currentUser();
      return ok(
        `✅ 로그인됨: ${u.nickname} (@${u.urlname}), note_count=${u.noteCount}\ncontent dir: ${cfg.contentDir}`,
      );
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  "note_list_local",
  "content 디렉터리의 markdown 파일 목록과 note 동기화 상태(note_key/synced_at)를 보여준다.",
  { dir: z.string().optional().describe("스캔할 디렉터리 (기본: NOTE_CONTENT_DIR)") },
  async ({ dir }) => {
    try {
      const base = resolve(dir || cfg.contentDir);
      const files = listMarkdown(base);
      if (files.length === 0) return ok(`(${base} 에 markdown 파일 없음)`);
      const lines = files.map((f) => {
        const d = parseDoc(f).data;
        const rel = relative(base, f);
        const synced = d.note_key ? `note=${d.note_key} synced=${d.synced_at ?? "?"}` : "미동기화";
        return `- ${rel}  [${synced}]`;
      });
      return ok(`${base}\n${lines.join("\n")}`);
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  "note_preview",
  "markdown 파일을 note HTML로 변환한 결과와 경고를 미리 보여준다. (쓰기 없음, 안전한 dry-run. 이미지는 push 시 업로드됨)",
  { path: z.string().describe("markdown 파일 경로") },
  async ({ path }) => {
    try {
      const abs = resolve(path);
      const doc = parseDoc(abs);
      const title = resolveTitle(doc, abs);
      const warnings: string[] = [];
      const { html, bodyLength, warnings: cw } = await mdToNoteHtml(doc.content);
      warnings.push(...cw);
      const head = `제목: ${title}\n본문 길이: ${bodyLength}\n경고: ${warnings.length ? "\n  - " + warnings.join("\n  - ") : "없음"}`;
      const preview = html.length > 1500 ? html.slice(0, 1500) + "\n…(생략)" : html;
      return ok(`${head}\n\n--- note HTML ---\n${preview}`);
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  "note_push",
  "markdown 파일을 note 초안으로 push한다(생성/갱신). 발행하지 않음. 성공 시 편집 URL과 frontmatter 갱신.",
  { path: z.string().describe("push할 markdown 파일 경로") },
  async ({ path }) => {
    try {
      const r = await pushFile(client(), path);
      const w = r.warnings.length ? `\n⚠ 경고:\n  - ${r.warnings.join("\n  - ")}` : "";
      return ok(
        `✅ ${r.created ? "새 초안 생성" : "초안 갱신"}: "${r.title}"\n편집: ${r.editUrl}\nnote_id=${r.noteId} note_key=${r.noteKey}${w}`,
      );
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  "note_delete_draft",
  "note 초안을 삭제한다. note_id를 직접 주거나, markdown 파일 경로(path)로 frontmatter에서 note_id를 읽는다.",
  {
    note_id: z.number().optional().describe("삭제할 초안의 note_id"),
    path: z.string().optional().describe("note_id를 읽을 markdown 파일 경로"),
  },
  async ({ note_id, path }) => {
    try {
      let id = note_id;
      if (!id && path) {
        const d = parseDoc(resolve(path)).data;
        if (typeof d.note_id === "number") id = d.note_id;
      }
      if (!id) throw new Error("note_id 또는 note_id가 기록된 path가 필요합니다.");
      await client().deleteDraft(id);
      return ok(`🗑️ 초안 삭제 완료 (note_id=${id})`);
    } catch (e) {
      return err(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
