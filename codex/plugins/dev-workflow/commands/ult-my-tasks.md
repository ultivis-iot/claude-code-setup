# 내 Task 목록

현재 사용자에게 할당된 Notion Task를 조회하고, 선택 시 브랜치를 자동 체크아웃/생성합니다.

## 실행

```bash
${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-my-tasks.sh [--week | --all]
```

스크립트가 처리하는 것:
- Github user → Member 캐시로 Notion user ID 매핑
- Task DB 쿼리 (기본: 시작전/진행중)
- Story / Repository 이름 병렬 조회
- 상태별 그룹핑 출력 + 마감 표시
- 선택 시:
  - 진행 중 + 기존 브랜치 있음 → 체크아웃
  - Issue URL이 없으면 Task 본문으로 GitHub Issue 생성 후 Task에 URL 반영
  - 시작 전 → `<issue_num>-<topic>-<slug>` 브랜치 생성

## 옵션

| 플래그 | 동작 |
|---|---|
| (기본) | 시작전 + 진행중 |
| `--week` | 이번 Week 기간 Task (완료 포함) — TODO: Week 필터 구현 |
| `--all` | 모든 상태 |

## 주의

- 첫 실행 시 Member DB 캐싱 (~1s)
- 이후 24h 동안 캐시 재사용
