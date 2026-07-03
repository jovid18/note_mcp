import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv();

export interface NoteConfig {
  /** _note_session_v5 쿠키 값 (httpOnly 세션) */
  sessionCookie: string;
  /** 로컬 markdown 디렉터리 (절대경로) */
  contentDir: string;
  /** refresh-cookie가 사용할 Chrome 프로필명 (빈 문자열이면 자동 탐지) */
  chromeProfile: string;
}

export function getConfig(): NoteConfig {
  const sessionCookie = process.env.NOTE_SESSION_V5?.trim() ?? "";
  const contentDir = resolve(process.env.NOTE_CONTENT_DIR?.trim() || "./content");
  const chromeProfile = process.env.NOTE_CHROME_PROFILE?.trim() ?? "";
  return { sessionCookie, contentDir, chromeProfile };
}

/** 쿠키가 없으면 안내 메시지와 함께 throw */
export function requireSessionCookie(cfg: NoteConfig): string {
  if (!cfg.sessionCookie) {
    throw new Error(
      "NOTE_SESSION_V5 쿠키가 없습니다. `npm run refresh-cookie`로 Chrome에서 추출하거나 .env에 직접 넣으세요.",
    );
  }
  return cfg.sessionCookie;
}
