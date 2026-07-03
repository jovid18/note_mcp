import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import matter from "gray-matter";

export interface NoteFrontmatter {
  title?: string;
  note_key?: string;
  note_id?: number;
  status?: string;
  tags?: string[];
  synced_at?: string;
  [key: string]: unknown;
}

export interface ParsedDoc {
  data: NoteFrontmatter;
  /** frontmatter를 제외한 markdown 본문 */
  content: string;
}

export function parseDoc(filePath: string): ParsedDoc {
  const raw = readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  return { data: data as NoteFrontmatter, content };
}

/** 제목 결정: frontmatter.title > 첫 # 헤딩 > 파일명 */
export function resolveTitle(doc: ParsedDoc, filePath: string): string {
  if (doc.data.title && String(doc.data.title).trim()) return String(doc.data.title).trim();
  const h1 = doc.content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return basename(filePath).replace(/\.md$/i, "");
}

/** frontmatter에 값들을 병합해 파일에 다시 쓴다 (본문은 보존) */
export function writeBackFrontmatter(filePath: string, updates: Partial<NoteFrontmatter>): void {
  const raw = readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  const data = { ...(parsed.data as NoteFrontmatter), ...updates };
  const next = matter.stringify(parsed.content, data);
  writeFileSync(filePath, next);
}
