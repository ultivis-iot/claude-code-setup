# 현재 Task에 메모/결정사항 추가

작업 중 발견한 사항을 현재 브랜치의 Notion Task에 코멘트로 추가합니다.

## 실행

```bash
~/.claude/scripts/isaac-task-note.sh "<메모 내용>"
```

스크립트가 처리하는 것:
- 현재 브랜치 → Issue 번호 추출
- Issue 번호로 Notion Task 검색
- Member 캐시에서 작성자 이름 조회 (git user → Notion 이름)
- `[작성자] 내용` 형식으로 코멘트 추가

## 사용 예

```
/isaac-task-note "Token refresh 흐름 백엔드 확인 대기 (김OO)"
/isaac-task-note "vite.config에 ESM 호환 옵션 추가로 해결"
```

## 실패 케이스

- 브랜치명에서 Issue 번호 추출 실패 → 사용자에게 안내
- Task DB에 해당 Issue가 등록되지 않음 → 안내
- Notion 토큰 없음 → setup 재실행 안내
