const CONFIG = {
  recipient: 'ssk1024@2000fmc.or.kr',
  timezone: 'Asia/Seoul',
  startHour: 9,
  endHour: 17,
  maxSeenIds: 200,
  boards: [
    { id: 'i-74', name: '고객의 소리', url: 'https://www.2000fmc.or.kr/ic-kr/bbs/i-74/list.do' },
    { id: 'i-75', name: '고객제안', url: 'https://www.2000fmc.or.kr/ic-kr/bbs/i-75/list.do' },
    { id: 'i-76', name: '주민참여예산', url: 'https://www.2000fmc.or.kr/ic-kr/bbs/i-76/list.do' },
    { id: 'i-77', name: '칭찬합시다', url: 'https://www.2000fmc.or.kr/ic-kr/bbs/i-77/list.do' },
    { id: 'i-78', name: '안전신문고', url: 'https://www.2000fmc.or.kr/ic-kr/bbs/i-78/list.do' },
  ],
};

const STATE_PROPERTY = 'BOARD_MONITOR_STATE_V1';

function scheduledBoardCheck() {
  if (!isBusinessHour_(new Date())) {
    console.log('업무시간이 아니므로 종료합니다.');
    return;
  }
  checkBoards();
}

function checkBoards() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log('다른 실행이 진행 중이므로 종료합니다.');
    return;
  }

  try {
    const state = loadState_();
    const nextState = JSON.parse(JSON.stringify(state));
    const allNewPosts = [];
    const errors = [];

    CONFIG.boards.forEach(function (board) {
      try {
        console.log('게시판 확인 시작: ' + board.name);
        const posts = fetchBoardPosts_(board);
        const boardState = state.boards[board.id];

        if (!boardState || !Array.isArray(boardState.seenPostIds)) {
          updateBoardState_(nextState, board, posts, []);
          console.log('첫 확인: ' + board.name + ' 현재 게시글 ' + posts.length + '건 저장');
          return;
        }

        const seen = new Set(boardState.seenPostIds);
        const newPosts = posts.filter(function (post) {
          return !seen.has(post.id);
        });

        if (newPosts.length === 0) {
          updateBoardState_(nextState, board, posts, boardState.seenPostIds);
          console.log('새 게시글 없음: ' + board.name);
          return;
        }

        console.log('새 게시글 ' + newPosts.length + '건 발견: ' + board.name);
        Array.prototype.push.apply(allNewPosts, newPosts);
      } catch (error) {
        const message = board.name + ': ' + error.message;
        errors.push(message);
        console.error(message);
      }
    });

    if (allNewPosts.length > 0) {
      sendAlertEmail_(allNewPosts);
      CONFIG.boards.forEach(function (board) {
        try {
          const posts = fetchBoardPosts_(board);
          const previous = state.boards[board.id];
          updateBoardState_(nextState, board, posts, previous ? previous.seenPostIds : []);
        } catch (error) {
          console.error('발송 후 상태 갱신 실패: ' + board.name + ': ' + error.message);
        }
      });
      console.log('이메일 발송 완료: ' + CONFIG.recipient);
    }

    saveState_(nextState);
    if (errors.length > 0) {
      throw new Error('일부 게시판 확인 실패\n' + errors.join('\n'));
    }
  } finally {
    lock.releaseLock();
  }
}

function installBusinessHourTriggers() {
  removeBoardTriggers_();
  for (let hour = CONFIG.startHour; hour <= CONFIG.endHour; hour += 1) {
    ScriptApp.newTrigger('scheduledBoardCheck')
      .timeBased()
      .atHour(hour)
      .nearMinute(30)
      .everyDays(1)
      .inTimezone(CONFIG.timezone)
      .create();
  }
  console.log('평일 09:30~17:30 시간대별 트리거 9개를 설치했습니다.');
}

function removeBoardTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() === 'scheduledBoardCheck';
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
}

function sendTestEmail() {
  MailApp.sendEmail({
    to: CONFIG.recipient,
    subject: '[게시판 모니터링] Gmail 발송 테스트',
    body: '2000FMC Board Monitor의 Google Apps Script 메일 발송 테스트입니다.\n\n' +
      '발송 시각: ' + Utilities.formatDate(new Date(), CONFIG.timezone, 'yyyy-MM-dd HH:mm:ss'),
  });
  console.log('테스트 이메일 발송 완료: ' + CONFIG.recipient);
}

function fetchBoardPosts_(board) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = UrlFetchApp.fetch(board.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': '2000fmc-board-monitor/1.0' },
      });
      const status = response.getResponseCode();
      if (status < 200 || status >= 300) {
        throw new Error('HTTP ' + status);
      }
      const posts = parseBoardPosts_(board, response.getContentText('UTF-8'));
      if (posts.length === 0) {
        throw new Error('게시글을 찾지 못했습니다.');
      }
      return posts;
    } catch (error) {
      lastError = error;
      if (attempt < 3) Utilities.sleep(attempt * 3000);
    }
  }
  throw new Error('게시판 접속 실패: ' + lastError.message);
}

function parseBoardPosts_(board, html) {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const posts = [];

  rows.forEach(function (row) {
    const numberMatch = row.match(/<td[^>]*class=["'][^"']*cell-no[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const subjectMatch = row.match(/<td[^>]*class=["'][^"']*cell-subject[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const dateMatch = row.match(/<td[^>]*class=["'][^"']*cell-date[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    if (!numberMatch || !subjectMatch || !dateMatch) return;

    const numberText = cleanText_(numberMatch[1]);
    const numberValue = Number((numberText.match(/\d+/) || [])[0]);
    const linkMatch = subjectMatch[1].match(/<a[^>]*href=["']([^"']*detail\.do\?ntt_sn=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!numberValue || !linkMatch) return;

    const nttSn = linkMatch[2];
    const title = cleanText_(linkMatch[3].replace(/<span[^>]*class=["'][^"']*comment-number[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ''));
    if (!title) return;

    posts.push({
      id: 'ntt_sn:' + nttSn,
      boardId: board.id,
      boardName: board.name,
      number: numberValue,
      title: title,
      date: cleanText_(dateMatch[1]),
      link: board.url.replace('/list.do', '/detail.do') + '?ntt_sn=' + nttSn,
    });
  });

  return posts.sort(function (a, b) { return b.number - a.number; });
}

function cleanText_(html) {
  return decodeHtml_(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml_(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text
    .replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, function (_, entity) {
      if (entity.charAt(0) !== '#') return named[entity.toLowerCase()] || _;
      const hex = entity.toLowerCase().indexOf('#x') === 0;
      return String.fromCharCode(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
    });
}

function sendAlertEmail_(posts) {
  const lines = ['모니터링 중인 게시판에 새 게시글이 등록되었습니다.', ''];
  let currentBoard = '';

  posts.sort(function (a, b) {
    return a.boardName.localeCompare(b.boardName) || a.number - b.number;
  }).forEach(function (post) {
    if (currentBoard !== post.boardName) {
      currentBoard = post.boardName;
      lines.push('[' + currentBoard + ']', '');
    }
    lines.push(
      '- 번호: ' + post.number,
      '  제목: ' + post.title,
      '  등록일: ' + post.date,
      '  상세 링크: ' + post.link,
      ''
    );
  });

  MailApp.sendEmail({
    to: CONFIG.recipient,
    subject: '[게시판] 새 게시글 알림',
    body: lines.join('\n').trim() + '\n',
  });
}

function loadState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
  if (!raw) return { boards: {} };
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('저장된 확인 상태를 읽지 못했습니다: ' + error.message);
  }
}

function saveState_(state) {
  state.updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(STATE_PROPERTY, JSON.stringify(state));
}

function updateBoardState_(state, board, posts, previousSeenIds) {
  const ids = posts.map(function (post) { return post.id; }).concat(previousSeenIds || []);
  const uniqueIds = ids.filter(function (id, index) { return ids.indexOf(id) === index; });
  state.boards[board.id] = {
    name: board.name,
    lastSeenNumber: posts.length ? posts[0].number : 0,
    seenPostIds: uniqueIds.slice(0, CONFIG.maxSeenIds),
    updatedAt: new Date().toISOString(),
    boardUrl: board.url,
  };
}

function isBusinessHour_(date) {
  const weekday = Number(Utilities.formatDate(date, CONFIG.timezone, 'u'));
  const hour = Number(Utilities.formatDate(date, CONFIG.timezone, 'H'));
  return weekday >= 1 && weekday <= 5 && hour >= CONFIG.startHour && hour <= CONFIG.endHour;
}
