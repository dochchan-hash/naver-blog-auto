// 공사전·공사중의 설정은 사용자 자료 폴더에 보관하며 Git과 배포 소스에서 제외한다.
const fs = require('fs');
const path = require('path');

// 스튜디오의 사용자 자료 폴더에만 쓴다. 패키지 안의 소스는 읽기 전용이다.
const ROOT = path.resolve(process.env.LEMONHOUSE_CONSTRUCTION_DATA_DIR);
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(ROOT, 'cafe.config.json');

function readUser() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

const user = readUser();
const env = process.env;
const ai = user.ai || {};

module.exports = {
  ROOT,
  DATA_DIR,
  CONFIG_FILE,
  JOBS_DIR: path.join(DATA_DIR, 'jobs'),
  STYLE_FILE: path.join(DATA_DIR, 'style.json'),
  BOARDS_FILE: path.join(DATA_DIR, 'boards.json'),
  ASSET_DIR: path.join(ROOT, 'assets'),

  // 카페 주소(cafe.naver.com/f-e/cafes/숫자/articles/…)의 숫자.
  CAFE_ID: String(env.CAFE_ID || user.cafeId || '').trim(),
  // 글 맨 아래에 붙는 대표번호. 화면의 설정 탭에서도 고칠 수 있다.
  PHONE: String(env.CAFE_PHONE || user.phone || '').trim(),
  // 글쓰기 프롬프트에 들어가는 업체명.
  COMPANY: String(env.CAFE_COMPANY || user.companyName || '인테리어 업체').trim(),

  // AI 종류: 'claude'(Claude Code CLI) 또는 'codex'(ChatGPT 로그인 Codex CLI).
  AI_PROVIDER: String(env.AI_PROVIDER || ai.provider || 'claude').trim().toLowerCase(),
  AI_MODEL: String(env.AI_MODEL || ai.model || '').trim() || undefined,

  // 크롬을 디버그 모드로 띄워 두고 거기에 연결한다.
  // 최신 크롬은 평소 쓰는 프로필에는 디버그 연결을 막으므로, 이 앱 전용 프로필 폴더를 쓴다.
  CHROME_PROFILE: path.join(ROOT, 'auth', 'cafe-chrome'),
};
