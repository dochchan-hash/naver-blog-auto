// 설치형은 스튜디오의 네이버 연결을 메모리로 공유한다.
// 독립 개발 실행에서만 전용 Chrome과 auth/ 쿠키 파일을 사용한다.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { CHROME_PROFILE, CAFE_ID } = require('./config');

function cdpUrl() {
  try {
    const port = Number(fs.readFileSync(path.join(CHROME_PROFILE, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? `http://127.0.0.1:${port}` : null;
  } catch { return null; }
}
const CAFE_HOME = `https://cafe.naver.com/f-e/cafes/${CAFE_ID}`;
const REQUIRED_COOKIES = ['NID_AUT', 'NID_SES'];
const COOKIE_FILE = path.join(path.dirname(CHROME_PROFILE), 'cafe-cookies.json'); // auth/ 폴더 (git·공유 대상 아님)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
let studioCookies = null;
function useStudioCookies(cookies) {
  if (!Array.isArray(cookies)) throw new Error('네이버 로그인 연결 형식을 확인해 주세요.');
  studioCookies = cookies.filter(c => typeof c.name === 'string' && typeof c.value === 'string' && /^NID_/.test(c.name) && /(^|\.)naver\.com$/.test(c.domain));
}

const hasLogin = (cookies) => {
  const names = new Set(cookies.map((c) => c.name));
  return REQUIRED_COOKIES.every((n) => names.has(n));
};

function loadCookies() {
  if (studioCookies !== null) return studioCookies;
  try {
    const c = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
}
function saveCookies(cookies) {
  const naver = cookies.filter((c) => /naver\.com$/.test(String(c.domain).replace(/^\./, '')));
  if (!hasLogin(naver)) return false;
  if (studioCookies !== null) { studioCookies = naver; return true; }
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(naver));
  return true;
}
/** 저장해 둔 로그인을 버린다 (만료됐을 때). */
function forgetLogin() {
  if (studioCookies !== null) { studioCookies = []; return; }
  try {
    fs.rmSync(COOKIE_FILE, { force: true });
  } catch {
    /* 이미 없음 */
  }
}

function findChrome() {
  const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const root of roots) {
    const p = path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('크롬(chrome.exe)을 찾지 못했습니다. 크롬이 설치돼 있는지 확인해 주세요.');
}

/** 디버그 포트가 열려 있는지 (= 앱 전용 크롬이 떠 있는지). */
function alive() {
  const endpoint = cdpUrl();
  if (!endpoint) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.get(`${endpoint}/json/version`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 앱 전용 크롬을 띄운다. 이미 떠 있으면 그대로 둔다. */
const LOGIN_URL = 'https://nid.naver.com/nidlogin.login?url=' + encodeURIComponent(CAFE_HOME);

async function launch(url = LOGIN_URL) {
  if (await alive()) {
    // 이미 떠 있으면 새 탭으로 로그인 화면을 열고 창을 앞으로 가져온다.
    const browser = await chromium.connectOverCDP(cdpUrl());
    try {
      const context = browser.contexts()[0];
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.bringToFront().catch(() => {});
    } finally {
      await browser.close().catch(() => {});
    }
    watchLogin();
    return { already: true };
  }
  fs.mkdirSync(CHROME_PROFILE, { recursive: true });
  const child = spawn(
    findChrome(),
    [
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${CHROME_PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ],
    { detached: true, stdio: 'ignore', windowsHide: false }
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await alive()) {
      watchLogin();
      return { already: false };
    }
  }
  throw new Error('크롬을 디버그 모드로 띄우지 못했습니다.');
}

/**
 * 로그인 크롬에서 로그인된 걸 확인하면 쿠키를 파일에 옮겨 둔다. (로그인 창을 연 뒤 한동안 지켜본다)
 * 사용자가 로그인을 마치고 크롬을 닫아도 이어 쓸 수 있게 하기 위해서다.
 */
let watching = false;
async function snapshot() {
  if (studioCookies !== null) return hasLogin(studioCookies);
  if (!(await alive())) return false;
  const browser = await chromium.connectOverCDP(cdpUrl());
  try {
    const context = browser.contexts()[0];
    return context ? saveCookies(await context.cookies()) : false;
  } finally {
    await browser.close().catch(() => {});
  }
}
function watchLogin() {
  if (watching) return;
  watching = true;
  const until = Date.now() + 15 * 60 * 1000;
  const tick = async () => {
    try {
      if (Date.now() > until || !(await alive())) return void (watching = false);
      await snapshot();
    } catch {
      /* 다음에 다시 */
    }
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

// 같은 브라우저를 동시에 만지지 않도록 줄을 세운다.
let queue = Promise.resolve();

/**
 * 보이지 않는 크롬(headless)을 띄워 fn(context) 를 실행한다. 끝나면 닫는다.
 * 저장해 둔 로그인 쿠키를 넣어 로그인된 상태로 시작한다. 로그인 창이 떠 있고 로그인돼 있으면 거기서 쿠키를 새로 가져온다.
 */
function withContext(fn, { needLogin = true, visible = false } = {}) {
  const run = async () => {
    await snapshot().catch(() => {});
    const cookies = loadCookies();
    if (needLogin && !hasLogin(cookies)) {
      throw new Error('카페에 로그인돼 있지 않습니다. 설정 탭의 [로그인 창 열기]로 열린 크롬에서 로그인한 뒤 다시 시도해 주세요.');
    }
    const browser = await chromium.launch({ channel: 'chrome', headless: !visible, ...(visible ? { args: ['--start-maximized'] } : {}) });
    let prepared = false;
    try {
      const context = await browser.newContext({ viewport: visible ? null : { width: 1400, height: 1000 }, locale: 'ko-KR', userAgent: UA });
      if (cookies.length) await context.addCookies(cookies);
      try {
        const result = await fn(context);
        prepared = visible && result?.prepared === true;
        return result;
      } finally {
        // 네이버가 새로 내려준 쿠키로 갱신해 둔다 (로그인이 풀렸으면 저장하지 않는다)
        saveCookies(await context.cookies().catch(() => []));
      }
    } finally {
      if (!prepared) await browser.close().catch(() => {});
    }
  };
  const result = queue.then(run, run);
  queue = result.then(() => {}, () => {});
  return result;
}

/** 카페에 로그인돼 있는지. running = 로그인용 크롬 창이 떠 있는지, loggedIn = 쓸 수 있는 로그인이 있는지. */
async function status() {
  const running = await alive();
  if (running) await snapshot().catch(() => {});
  return { running, loggedIn: hasLogin(loadCookies()) };
}

module.exports = { launch, withContext, status, forgetLogin, useStudioCookies };
