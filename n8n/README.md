# n8n 워크플로우 — Notion ↔ Github 자동화

이 디렉토리에는 개발팀이 사용 중인 n8n 워크플로우 정의 5개가 보관되어 있습니다.
실제 운영은 별도의 n8n 인스턴스에서 동작하며, 이 파일들은 **참조용 export**입니다.

## 워크플로우 목록

| 파일 | 트리거 | 동작 | 영향 DB |
|---|---|---|---|
| `Webhook _ Notion to Github (Issue).json` | Notion 버튼 클릭 | Task 정보 → Github Issue 생성/업데이트 | Task의 Issue URL |
| `Webhook _ Github to Notion (Create a branch).json` | Github webhook: branch create | 브랜치 ↔ Task 매칭, Status 진행 중 전환 | Task, Commit |
| `Webhook _ Github to Notion (Commit).json` | Github webhook: push | Commit DB에 행 추가, Task 자동 연결 | Commit |
| `Webhook _ Github to Notion (PR Create _ Synchronize).json` | Github webhook: PR opened/updated | Task → AI검토중, Claude Code 서브워크플로우 호출, PR 코멘트 | Task |
| `Webhook _ Github to Notion (PR Evaluation).json` | Github webhook: PR closed | merged → 완료 / 그냥 닫힘 → 미완료 | Task |

## 자동 상태 전이

```
시작 전
  ↓ (브랜치 생성)
진행 중
  ↓ (PR opened)
AI검토중  ← Claude Code 서브워크플로우가 자동 코드 리뷰 → Github PR 코멘트
  ↓ (PR closed)
완료 (merged) / 미완료 (closed without merge)
```

## Claude Code 스킬과의 책임 분리

| 동작 | 누가 |
|---|---|
| Plan → Story + Task + Issue + 브랜치 (kickoff) | `/isaac-story-create` |
| 즉석 Task 추가 (Notion 버튼) | n8n #1 |
| 즉석 Task 추가 (Claude에서) | `/isaac-task-create` |
| 브랜치 생성 → Task 진행 중 | n8n #2 |
| 커밋 누적 → Commit DB | n8n #3 |
| 로컬 검증 결과 → Task 코멘트 | `/commit-and-verify` |
| PR 생성 → AI 리뷰 + Task AI검토중 | n8n #4 |
| PR 종료 → Task 완료/미완료 | n8n #5 |
| 메모/결정사항 → Task 코멘트 | `/isaac-task-note` |
| 비정형 상태 변경 (취소/재개) | `/isaac-task-status` |

## 워크플로우 갱신 시

이 디렉토리는 운영 인스턴스의 단방향 export입니다 — 여기 수정해도 운영에 반영되지 않습니다.
워크플로우 변경 시:
1. n8n 운영 인스턴스에서 직접 수정
2. 변경된 워크플로우를 export → 이 디렉토리에 덮어쓰기
3. README 표 갱신 필요 시 함께 업데이트
