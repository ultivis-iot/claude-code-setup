# 주간 작업 정리

Notion Week DB 기간 기준으로 본인의 주간 작업을 집계 → LLM 요약 → 사용자 확인 후 일일 업무 보고 DB에 발행.

## 분리된 책임

| 단계 | 누가 | 무엇을 |
|---|---|---|
| 데이터 수집 | **`scripts/isaac-weekly-collect.sh`** | Week/Task/Story/Project 병렬 fetch + 통계 집계 → JSON |
| 요약/하이라이트 | **LLM (이 스킬)** | JSON 분석 → 마크다운 보고서 작성, 이슈 식별 |
| 발행 | **`scripts/isaac-weekly-publish.sh`** | 마크다운을 일일 업무 보고 DB에 페이지 생성 |

## 실행 단계

### 1. 데이터 수집

```bash
DATA=$(~/.claude/scripts/isaac-weekly-collect.sh)
# 옵션:
#   --week YYYY-MM-DD   특정 주
#   --team              팀 전체
```

수집된 JSON 구조:
```json
{
  "week": {"date_from": "...", "date_to": "..."},
  "user": "궁정원",
  "team_mode": false,
  "stats": {
    "total": 7,
    "by_status": {"완료": 5, "진행 중": 2},
    "total_commits": 63,
    "total_working": 65,
    "total_planned": 48,
    "overdue": [...],
    "on_time_low": [...]
  },
  "tasks": [{
    "id", "name", "topic", "status", "issue_num", "issue_url", "pr_url",
    "planned_start", "planned_end", "working_time", "planned_time",
    "on_time_rate", "first_commit", "last_commit",
    "story_id", "story_name", "project_id", "project_name",
    "commit_count", "assignees"
  }]
}
```

### 2. LLM 분석 + 마크다운 작성

LLM이 JSON을 읽고 다음 형식으로 마크다운 작성:

```markdown
# 주간 보고 — 2026-04-13 ~ 2026-04-19 (궁정원)

## 📊 요약
- 완료: 5 / 시작: 7 (71%)
- 커밋: 63개 · 작업시간 65h (계획 48h, 135% — 일부 초과)

## 🛡️ Project별

### Ultivis Edge
**📜 다양한 보기/필드 형식 지원** (Story 진행률 80%)
- ✅ #5 [Feature] 카드 뷰 추가  (8h, 계획 6h)
- ✅ #6 [Feature] 갤러리 뷰 추가  (10h, 계획 8h)
- 🔄 #9 [Update] 필드 지원 추가  (8h, AI검토중, PR #15)

### 시스템 리팩터링
- ⏸ JWKS 공개키 HTTPS 전환 (시작 전)

## ⚠ 이슈
- #6 시간 초과 (10h vs 8h, 125%)
- 시스템 리팩터링 Story 진행 정체 (50%, 1주째 시작 안 됨)

## 📝 메모/결정사항
(Task 코멘트에서 추출 — 향후 weekly-collect에 코멘트 수집 추가 시)
```

상태 아이콘: ✅ 완료 / 🔄 진행중 / ⏸ 시작전 / ❌ 미완료

### 3. 사용자 액션

```
[s] Notion 발행 / [c] 클립보드 복사 / [Enter] 종료
```

#### `s` — 발행
```bash
echo "$MARKDOWN" | ~/.claude/scripts/isaac-weekly-publish.sh \
    "Weekly: $WEEK_FROM ~ $WEEK_TO ($USER_NAME)" \
    "$WEEK_FROM"
```

#### `c` — 클립보드
```bash
echo "$MARKDOWN" | xclip -selection clipboard 2>/dev/null \
    || echo "$MARKDOWN" | pbcopy 2>/dev/null \
    || echo "$MARKDOWN" | clip.exe 2>/dev/null
```

## 옵션

| 인자 | 동작 |
|---|---|
| (기본) | 이번 주, 본인 |
| `--week <YYYY-MM-DD>` | 해당 날짜 포함 주 |
| `--team` | 팀 전체 (Member별 그룹핑은 LLM이 처리) |

## 주의

- 첫 호출 시 캐시 갱신으로 ~5초 (Story/Project fetch 포함)
- 이후 동일 주 호출은 빠름 (캐시 활용)
- 메모 수집은 향후 `--with-notes` 옵션으로 추가 예정 (Task 페이지 코멘트 retrieve)
