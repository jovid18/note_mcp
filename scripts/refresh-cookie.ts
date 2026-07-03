/**
 * Chrome 프로필에서 note 세션 쿠키(_note_session_v5)를 추출해 .env에 기록한다. (macOS 전용)
 *
 * 동작: Chrome Cookies SQLite(암호화) → macOS Keychain "Chrome Safe Storage" 키로
 * PBKDF2+AES-128-CBC 복호화 → note current_user로 검증 → .env 갱신.
 *
 * 사용: npm run refresh-cookie
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { NoteClient } from "../src/note-client.js";
import { getConfig } from "../src/config.js";

const CHROME_DIR = join(homedir(), "Library/Application Support/Google/Chrome");
const ENV_PATH = join(process.cwd(), ".env");

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function getSafeStorageKey(): string {
  try {
    return execFileSync("security", ["find-generic-password", "-wga", "Chrome"], {
      encoding: "utf8",
    }).trim();
  } catch {
    fail("Keychain에서 'Chrome Safe Storage' 키를 못 읽었습니다. 권한 팝업에서 '항상 허용'을 눌러주세요.");
  }
}

function listProfiles(): string[] {
  return readdirSync(CHROME_DIR).filter(
    (p) => (p === "Default" || p.startsWith("Profile ")) && existsSync(join(CHROME_DIR, p, "Cookies")),
  );
}

/** 프로필 Cookies DB(+WAL)를 임시로 복사해 _note_session_v5 암호화값(hex)을 읽는다 */
function readEncryptedSession(profile: string): string | null {
  const src = join(CHROME_DIR, profile, "Cookies");
  const dst = join(tmpdir(), `note_ck_${profile.replace(/\W/g, "_")}.db`);
  copyFileSync(src, dst);
  for (const ext of ["-wal", "-shm"]) {
    const s = src + ext;
    if (existsSync(s)) copyFileSync(s, dst + ext);
  }
  try {
    const out = execFileSync(
      "sqlite3",
      [
        dst,
        "SELECT hex(encrypted_value) FROM cookies WHERE host_key LIKE '%note.com%' AND name='_note_session_v5' LIMIT 1;",
      ],
      { encoding: "utf8" },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function decrypt(hex: string, safeKey: string): string {
  const key = crypto.pbkdf2Sync(safeKey, "saltysalt", 1003, 16, "sha1");
  const iv = Buffer.alloc(16, " ");
  const enc = Buffer.from(hex, "hex");
  const ct = enc.subarray(3); // 'v10' 버전 프리픽스 제거
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(true);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  const printable = (b: Buffer) => b.length > 0 && b.every((c) => c >= 32 && c < 127);
  // 신버전 Chrome은 평문 앞 32바이트에 도메인 해시 프리픽스를 붙임
  const val = printable(out) ? out : out.subarray(32);
  return val.toString("utf8");
}

function upsertEnv(value: string): void {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const line = `NOTE_SESSION_V5=${value}`;
  if (/^NOTE_SESSION_V5=.*$/m.test(content)) {
    content = content.replace(/^NOTE_SESSION_V5=.*$/m, line);
  } else {
    content += (content && !content.endsWith("\n") ? "\n" : "") + line + "\n";
  }
  writeFileSync(ENV_PATH, content);
}

async function main() {
  if (process.platform !== "darwin") fail("이 스크립트는 macOS 전용입니다.");
  if (!existsSync(CHROME_DIR)) fail(`Chrome 디렉터리를 못 찾음: ${CHROME_DIR}`);

  const cfg = getConfig();
  const safeKey = getSafeStorageKey();

  const profiles = cfg.chromeProfile ? [cfg.chromeProfile] : listProfiles();
  if (profiles.length === 0) fail("note 쿠키를 가진 Chrome 프로필을 못 찾았습니다.");

  for (const profile of profiles) {
    const hex = readEncryptedSession(profile);
    if (!hex) continue;
    let cookie: string;
    try {
      cookie = decrypt(hex, safeKey);
    } catch (e) {
      console.error(`  [${profile}] 복호화 실패: ${(e as Error).message}`);
      continue;
    }
    // 검증
    try {
      const user = await new NoteClient(cookie).currentUser();
      upsertEnv(cookie);
      console.log(`✔ [${profile}] 인증 성공 → ${user.nickname} (@${user.urlname})`);
      console.log(`✔ .env의 NOTE_SESSION_V5 갱신 완료.`);
      return;
    } catch {
      console.error(`  [${profile}] 쿠키는 추출했으나 인증 실패(로그아웃/만료). 다음 프로필 시도…`);
    }
  }
  fail("유효한 note 세션 쿠키를 가진 프로필이 없습니다. Chrome에서 note.com 로그인 후 다시 시도하세요.");
}

main().catch((e) => fail(e.message));
