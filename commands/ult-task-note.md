---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read
description: 작업 중 발견한 사항이나 결정사항을 현재 브랜치의 Notion Task에 코멘트로 추가
argument-hint: <메모 내용>
---

# 현재 Task에 메모/결정사항 추가

작업 중 발견한 사항을 현재 브랜치의 Notion Task에 코멘트로 추가합니다.

## 실행

```bash
node ~/.claude/scripts/ult-notion.mjs task-note "<메모 내용>"
```

인자: `$ARGUMENTS` (메모 내용). 비어 있으면 `사용법: /ult-task-note "<메모 내용>"` 을 보여주고 끝낸다.

스크립트가 처리하는 것:
- 현재 브랜치 → Issue 번호 추출 → `gh` 로 Issue URL 조회
- Issue URL 과 **정확히 일치**하는 Notion Task 검색 (이슈 번호만으로는 찾지 않는다: 저장소마다 번호가 겹친다)
- 검색 실패 시 title 매칭으로 Issue URL 자동 연결 시도
- Member 캐시에서 작성자 이름 조회 (GitHub 로그인 → Notion 이름)
- `[작성자] 내용` 형식으로 코멘트 추가

## 사용 예

```
/ult-task-note "Token refresh 흐름 백엔드 확인 대기 (김OO)"
/ult-task-note "vite.config에 ESM 호환 옵션 추가로 해결"
```

## 실패 케이스

- 브랜치명에서 Issue 번호 추출 실패 → 사용자에게 안내
- Task DB에 해당 Issue URL 이 등록되지 않음 → 자동 연결 시도 후 `/ult-task-link-issue` 안내
- Notion 토큰 없음 → 스크립트가 출력하는 토큰 설정 안내를 전달
