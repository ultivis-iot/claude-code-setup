# 전역 Claude Code 설정

## 기본 원칙
- 코드 변경 전 반드시 기존 패턴 확인

## Plan 모드 가이드
Plan 모드 사용 시 반드시 의도 섹션이 포함되어 **사용자의 의도를 명확하게 명문화**해야 합니다.

### Plan 저장 시점
1. Plan 모드 진입 시 프로젝트 루트에 tmp 디렉토리가 없으면 생성
2. **사용자 승인 완료 후, Build 시작 전에** `tmp/current-plan.md`로 복사
3. Build 중에는 Plan을 수정하지 않음 (원본 의도 보존)

### Plan 승인 후 분류 + 발행
Plan 승인 직후 (hook이 `tmp/current-plan.md`를 저장한 직후), Build 시작 전에 Plan 성격을 분류하고 적절한 스킬을 추천:

| Plan 성격 | 추천 스킬 |
|---|---|
| 거대한 Plan (새 사용자 가치, 여러 단계) | `/isaac-story-create` — 새 Story + Task N개 + Issue N개 + 브랜치 N개 |
| 기존 Story의 추가 작업 | `/isaac-task-create <story>` — Task 1개 + Issue + 브랜치 |
| 현재 Task의 보완/메모 | `/isaac-task-note '메모'` |
| 작은 일회성 변경 | 발행 없이 Build 시작 |

추천만 하고 **사용자 선택을 받음**. 명시적 거부 시 그대로 Build 시작.
### 의도 (Intent)
- 사용자가 원하는 것이 무엇인지 명확히 기술
- 기대 결과물 정의
- **사용자는 자신의 의도가 정확하게 문서화되었는지 반드시 확인해야 함**