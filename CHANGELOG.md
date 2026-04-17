# Changelog

## v0.5.0 (2026-04-17)
- **Notion MCP 연동** — setup.sh/ps1에 Internal Integration Token 등록 단계 추가 (user scope)
- **Isaac 스킬 6개 추가**:
  - `/isaac-my-tasks` — 본인 Task 조회 + worktree 자동 생성
  - `/isaac-story-create` — Plan → Story + Task N + Issue N + worktree N 일괄
  - `/isaac-task-create` — 기존 Story에 Task 추가
  - `/isaac-task-note` — Task에 메모 코멘트
  - `/isaac-task-status` — 비정형 상태 변경 (취소/재개)
  - `/isaac-weekly-report` — 주간 작업 정리 + 발행
- **공통 헬퍼**:
  - `scripts/notion-api.sh` — 토큰/캐시(members/projects/repos/schemas/templates)/lookup
  - `scripts/isaac-wt-add.sh` — repo abbr 기반 worktree 생성
- **기존 스킬 확장**:
  - `/issue` — Notion Task/Story/Project 컨텍스트 추가
  - `/commit-and-verify` — 검증 결과를 Task 코멘트로 자동 동기화
- **dev-tools 리팩터**:
  - `MAIN_PROJECT` 제거, `WORKTREE_ROOT`로 통합 (다중 프로젝트 지원)
  - repo 이니셜 축약 기반 폴더명 (`pm` / `ub` / `url` / `ccs` 등)
  - `dw` 2-tier hook 조회 (`.isaac/dw.sh` → `~/.claude/dev-tools/hooks/<repo>.sh` → 레거시)
  - `isaac-init` 명령어 신설 (status/setup/check/dw-hook)
- **Plan 승인 hook**: worktree 감지 + Plan 성격별 스킬 분류 추천

## v0.4.0 (2026-04-02)
- Docker 멀티유저 격리 지원 — 사용자명 해시 기반 포트 자동 할당 및 COMPOSE_PROJECT_NAME 자동 설정
- dev-commands.sh에서 하드코딩된 포트 제거, 사용자별 자동 계산으로 대체
- dw 명령어에 사용자별 --env-file 지원 추가
- setup.sh .env 생성 시 Docker 멀티유저 격리 안내 포함

## v0.3.0 (2026-02-06)
- visual-qa 커맨드 추가 — Chrome MCP 브라우저 자동화로 React 프론트엔드 UI/UX 검증
- visual-qa-analyzer 에이전트 추가 — 수집 데이터 기반 디자인 품질 평가 및 이슈 판정
- commit-and-verify에 visual-qa 선택적 3단계 통합 — 프론트엔드 변경 감지 시 사용자에게 제안
- validation-status.schema.json에 visual-qa 필드 추가

## v0.2.1 (2025-01-25)
- commit-and-verify에서 Plan 파일 선택 기능 추가 - 최근 5개 Plan 중 사용자가 직접 선택
- 동시 세션 환경에서 정확한 Plan 선택 지원

## v0.2.0 (2025-01-25)
- test-validator 추가 - 테스트 커버리지 및 테스트 통과 여부 검증
- test-validator를 검증 플로우(commit-and-verify)에 통합

## v0.1.2 (2025-01-25)
- Plan 복사 hook 수정 - `~/.claude/plans/`에서 최신 Plan 파일 복사 방식으로 변경
- ExitPlanMode 도구에 plan 파라미터가 없는 문제 해결

## v0.1.1 (2025-01-18)
- 버전 정책 도입 및 문서화
- setup.sh에 버전 비교 및 업데이트 내역 출력 기능 추가
- VERSION 파일 추가

## v0.1.0 (2025-01-18)
- Plan 복사 hook 개선 - tool_input.plan에서 직접 추출 방식으로 변경
- .gitignore 추가

## v0.0.x (2025-01-08 ~ 2025-01-15)
- subagent 결과 취합 방식 개선 - 메인에서 validation-status.json 생성
- templates/ 디렉토리 분리, 업데이트 검증 문서화
- 업데이트 시 원격 저장소 자동 pull 기능 추가
- security-validator commit-and-verify 호출 금지 강화
- Plan 승인 시 자동 복사 hook 추가
- --update 옵션 추가
- 커밋 메시지 컨벤션 문서화
- validation-status 스키마 및 브랜치별 검증 추가
- 서브에이전트 제한사항 명시
- PowerShell 한글 인코딩 수정
- Windows PowerShell 설치 스크립트 추가
- 최초 릴리스
