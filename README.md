# 2000FMC Board Monitor

이천시설관리공단 고객 게시판을 Google Apps Script로 확인하고, 새 게시글을 Gmail로 알리는 자동 모니터링 프로젝트입니다.

## 모니터링 대상

- 고객의 소리
- 고객제안
- 주민참여예산
- 칭찬합시다
- 안전신문고

## 동작 방식

1. Google Apps Script 시간 트리거가 `scheduledBoardCheck`를 실행합니다.
2. 각 게시판에서 번호, 제목, 등록일, 상세 링크를 수집합니다.
3. 상세 링크의 `ntt_sn`을 고유 ID로 사용해 신규 게시글을 판별합니다.
4. 신규 글이 있으면 `ssk1024@2000fmc.or.kr`로 Gmail 알림을 발송합니다.
5. 메일 발송 성공 후 확인한 ID를 Apps Script `PropertiesService`에 저장합니다.

게시글이 나중에 삭제되거나 게시글 번호가 낮아져도, 고유 ID 기준으로 다음 신규 글을 계속 감지합니다.

## 실행 일정

`installBusinessHourTriggers`를 한 번 실행하면 다음 시간대의 트리거 9개가 설치됩니다.

- 월요일~금요일
- 09:30~17:30
- 1시간 간격

Apps Script 시간 트리거 특성상 실제 실행은 지정 시각의 약 ±15분 범위에서 조정될 수 있습니다. 주말에는 함수가 즉시 종료됩니다.

## 주요 함수

- `installBusinessHourTriggers`: 업무시간 트리거 설치
- `scheduledBoardCheck`: 예약 실행 진입점
- `checkBoards`: 게시판 즉시 확인
- `sendTestEmail`: Gmail 테스트 발송

## GitHub 자동 배포

GitHub와 Apps Script는 Google 공식 CLI인 `clasp`로 연결되어 있습니다.

```text
apps-script 소스 수정
→ main 브랜치에 push
→ Deploy Apps Script 실행
→ Google Apps Script 프로젝트 자동 갱신
```

Google 인증정보는 저장소 파일이 아닌 GitHub Repository Secret `CLASPRC_JSON`에 보관합니다.

수동 배포가 필요하면 로컬에서 다음 명령을 실행합니다.

```bash
npm install
npm run apps-script:push
```

## 파일 구성

- `apps-script/Code.gs`: 게시판 확인, 신규 글 판별, Gmail 발송, 트리거 설치
- `apps-script/appsscript.json`: Apps Script 프로젝트 설정
- `.clasp.json`: Apps Script 프로젝트 연결 정보
- `.github/workflows/deploy-apps-script.yml`: GitHub 자동 배포
- `package.json`: clasp 실행 명령과 의존성

## 보안

- Google 비밀번호와 Gmail 비밀번호를 코드에 저장하지 않습니다.
- Gmail은 Apps Script 프로젝트 소유자의 승인된 권한으로 발송합니다.
- Google OAuth 인증정보는 `CLASPRC_JSON` Secret으로 관리합니다.
- 게시글 본문이나 개인정보를 상태 데이터에 저장하지 않습니다.
