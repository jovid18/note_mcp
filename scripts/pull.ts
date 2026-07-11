/**
 * note 발행 글(또는 초안)을 URL로 받아 로컬 markdown으로 내려받는다: npm run pull -- <url>
 *
 * ⚠ 이 프로젝트의 기본 방향은 로컬 md → note 단방향 push다(CLAUDE.md).
 * pull 은 note 웹 에디터에서 이미 쓴 글을 "로컬 SSoT로 처음 편입"할 때 쓰는 부트스트랩 용도.
 * 내려받은 뒤부터는 로컬 md 가 정답이며, 수정은 로컬에서 하고 note_push 로 되올린다.
 *
 * 사용:
 *   npm run pull -- https://note.com/jovid_18/n/n282446e3c14f
 *   npm run pull -- <url> --date 2026-07-02      # 파일명 날짜 강제
 *   npm run pull -- <url> --force                # 기존 파일 덮어쓰기
 *   npm run pull -- <url> --out content/foo.md   # 출력 경로 강제
 *   npm run pull -- <url> --dir ../kaiwa-lab/diary # 출력 디렉토리만 변경 (파일명 날짜 로직은 유지)
 */
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import matter from "gray-matter";
import { getConfig, requireSessionCookie } from "../src/config.js";
import { NoteClient } from "../src/note-client.js";
import { noteHtmlToMd } from "../src/note-to-md.js";

interface Args {
  url?: string;
  date?: string;
  out?: string;
  dir?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--force") a.force = true;
    else if (v === "--date") a.date = argv[++i];
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--dir") a.dir = argv[++i];
    else if (!v.startsWith("--") && !a.url) a.url = v;
  }
  return a;
}

/** note URL/편집 URL/키 → note key (n로 시작하는 식별자) */
function extractKey(input: string): string {
  const s = input.trim();
  let m =
    s.match(/\/n\/(n[0-9a-z]+)/i) || // https://note.com/<user>/n/<key>
    s.match(/\/notes\/(n[0-9a-z]+)/i); // https://editor.note.com/notes/<key>/edit
  if (m) return m[1];
  m = s.match(/^(n[0-9a-z]{8,})$/i); // 키만 준 경우
  if (m) return m[1];
  throw new Error(`note key를 URL에서 찾지 못했습니다: ${input}`);
}

const pad = (n: string | number) => String(n).padStart(2, "0");

/** 파일명 날짜(YYYY-MM-DD) 결정: --date > 제목의 날짜 > publish_at/created_at */
function resolveDate(args: Args, title: string | null, publishAt: string | null, createdAt: string | null): {
  date: string;
  source: string;
} {
  if (args.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error(`--date 형식은 YYYY-MM-DD 여야 합니다: ${args.date}`);
    return { date: args.date, source: "--date" };
  }
  const ref = publishAt || createdAt || "";
  const refYear = ref.slice(0, 4);
  const t = (title ?? "").trim();
  let m = t.match(/(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, source: "제목" };
  m = t.match(/(?:^|\D)(\d{1,2})[.\/](\d{1,2})(?:\D|$)/);
  if (m && refYear) return { date: `${refYear}-${pad(m[1])}-${pad(m[2])}`, source: `제목 + ${publishAt ? "발행" : "생성"}연도` };
  if (ref) return { date: ref.slice(0, 10), source: publishAt ? "발행일시" : "생성일시" };
  throw new Error("파일명 날짜를 결정할 수 없습니다. --date YYYY-MM-DD 로 지정하세요.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) throw new Error("사용법: npm run pull -- <note-url> [--date YYYY-MM-DD] [--force] [--out path] [--dir path]");

  const cfg = getConfig();
  const client = new NoteClient(requireSessionCookie(cfg));
  const key = extractKey(args.url);

  // 발행 글은 draft=false, 초안은 draft=true. 발행 우선 시도.
  let note = await client.getNote(key, { draft: false });
  if (!note.body) note = await client.getNote(key, { draft: true });

  const { markdown, warnings } = noteHtmlToMd(note.body ?? "");
  const { date, source } = resolveDate(args, note.name, note.publishAt, note.createdAt);

  const outPath = args.out
    ? resolve(args.out)
    : join(args.dir ? resolve(args.dir) : cfg.contentDir, `${date}.md`);

  if (existsSync(outPath) && !args.force) {
    throw new Error(`이미 존재: ${outPath}\n덮어쓰려면 --force, 다른 이름은 --out 사용.`);
  }

  const frontmatter: Record<string, unknown> = {
    title: note.name ?? key,
    note_id: note.id,
    note_key: note.key,
    status: note.status,
    ...(note.tags.length ? { tags: note.tags } : {}),
    source_url: args.url,
    ...(note.publishAt ? { published_at: note.publishAt } : {}),
    pulled_at: new Date().toISOString(),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, matter.stringify("\n" + markdown, frontmatter));

  console.log(`✅ 저장 완료: ${outPath}`);
  console.log(`   제목: ${note.name}  (status=${note.status})`);
  console.log(`   날짜: ${date} (출처: ${source})`);
  if (note.tags.length) console.log(`   태그: ${note.tags.join(", ")}`);
  if (warnings.length) console.log(`⚠ 변환 경고:\n   - ${warnings.join("\n   - ")}`);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
