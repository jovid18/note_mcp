/** 빠른 인증 확인 CLI: npm run status */
import { getConfig, requireSessionCookie } from "../src/config.js";
import { NoteClient } from "../src/note-client.js";

async function main() {
  const cfg = getConfig();
  const cookie = requireSessionCookie(cfg);
  const user = await new NoteClient(cookie).currentUser();
  console.log(`✔ 로그인: ${user.nickname} (@${user.urlname})  note_count=${user.noteCount}`);
  console.log(`  content dir: ${cfg.contentDir}`);
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
