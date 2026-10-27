// claude CLI(-p) 를 서브에이전트처럼 한 번씩 돌린다.
//
// API 키를 쓰지 않는다. 로컬에 로그인된 Claude Code 구독 계정을 그대로 탄다.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * claude 실행 파일을 찾는다.
 *
 * 🚨 윈도우에서 claude.cmd 를 spawn 하면 EINVAL 이 난다 (Node 의 배치파일 실행 차단).
 * 그래서 패키지에 같이 들어있는 claude.exe 를 직접 찾아 쓴다.
 */
function resolveBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform !== 'win32') return 'claude';

  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  }
  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf8', windowsHide: true }).trim();
    candidates.push(path.join(npmRoot, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  } catch {
    // npm 이 없어도 위 후보로 찾을 수 있다.
  }

  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      'claude 실행 파일을 찾지 못했습니다. `npm i -g @anthropic-ai/claude-code` 로 설치하거나 CLAUDE_BIN 환경변수로 경로를 지정해 주세요.'
    );
  }
  return found;
}

let cachedBin = null;
function getBin() {
  if (!cachedBin) cachedBin = resolveBin();
  return cachedBin;
}

/** 도구 호출 한 줄 요약 — 로그가 장황해지지 않게 짧게 줄인다. */
function describeTool(name, input = {}) {
  const short = (v, n = 60) => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ');
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  switch (name) {
    case 'Read':
      return `읽는 중 — ${short(input.file_path, 70)}`;
    case 'Write':
      return `저장 중 — ${short(input.file_path, 70)}`;
    case 'Edit':
      return `수정 중 — ${short(input.file_path, 70)}`;
    case 'Bash':
      return `실행 — ${short(input.command)}`;
    case 'WebSearch':
      return `검색 — ${short(input.query)}`;
    case 'WebFetch':
      return `조회 — ${short(input.url)}`;
    case 'Glob':
    case 'Grep':
      return `탐색 — ${short(input.pattern)}`;
    default:
      return `${name}`;
  }
}

/**
 * claude 가 뱉는 영어 안내를 알아볼 수 있는 한국어로 바꾼다.
 * 특히 구독 한도는 코드 문제가 아니라 기다리면 풀리는 것이므로 구분해서 알려준다.
 */
function explain(raw) {
  const limit = raw.match(/hit your (?:session|usage) limit[^\n]*?resets\s+([^\n·]+)/i);
  if (limit) {
    // 언제 풀리는지는 Claude 가 알려준 사실이다. 기억해 두면 다음 작업을 헛돌리지 않는다.
    return `Claude 구독 사용량 한도에 걸렸습니다. ${limit[1].trim()} 에 풀립니다. 그 뒤에 다시 시도해 주세요.`;
  }
  if (/hit your (?:session|usage) limit|rate limit/i.test(raw)) {
    return 'Claude 구독 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.';
  }
  if (/not logged in|please run .*login|authentication/i.test(raw)) {
    return 'Claude CLI 로그인이 풀렸습니다. 터미널에서 `claude` 를 실행해 로그인해 주세요.';
  }
  return raw;
}

/**
 * claude -p 를 한 번 돌린다.
 *
 * onLog(message, level) 로 진행 상황이 실시간으로 흘러나온다.
 * onProcess(child) 로 프로세스 핸들을 넘겨준다 (중단용).
 */
function run({
  prompt,
  cwd,
  allowedTools,
  model,
  onLog = () => {},
  onProcess = () => {},
}) {
  const args = ['-p', prompt];
  args.push(
    '--output-format', 'stream-json',
    '--verbose',
    // 파일 쓰기까지는 허용하되, 권한 확인을 끄지는 않는다.
    '--permission-mode', 'acceptEdits',
  );
  // -p 모드에서는 권한 질문에 답할 사람이 없다. 쓸 도구를 미리 못박아 둔다.
  if (allowedTools) args.push('--allowedTools', allowedTools);
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const child = spawn(getBin(), args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    onProcess(child);

    let buffer = '';
    let finalText = '';
    let errorText = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // stream-json 은 한 줄에 JSON 하나(NDJSON)다.
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue; // JSON 이 아닌 줄은 무시한다
        }

        if (event.type === 'assistant' && event.message) {
          for (const block of event.message.content || []) {
            if (block.type === 'text' && block.text.trim()) {
              onLog(block.text.trim().split('\n')[0].slice(0, 140));
            } else if (block.type === 'tool_use') {
              onLog(describeTool(block.name, block.input));
            }
          }
        } else if (event.type === 'result') {
          finalText = event.result || '';
          if (event.is_error) errorText = finalText;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) errorText += text + '\n';
    });

    child.on('error', (error) => {
      reject(new Error(`claude 실행 실패: ${error.message} (claude CLI 가 설치돼 있는지 확인해 주세요)`));
    });

    child.on('close', (code, signal) => {
      if (signal) return reject(new Error('작업이 중단되었습니다.'));
      if (code !== 0) {
        return reject(new Error(explain(errorText.trim() || `claude 가 오류로 종료했습니다 (코드 ${code})`)));
      }
      // 종료코드가 0이어도 한도 안내만 남기고 끝나는 경우가 있다.
      if (/hit your (session|usage) limit|rate limit/i.test(finalText)) {
        return reject(new Error(explain(finalText)));
      }
      resolve({ text: finalText });
    });
  });
}

module.exports = { run };
