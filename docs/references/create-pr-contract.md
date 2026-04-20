# Create PR Contract

`/create-pr`에서 validation-status 해석 기준을 다시 확인할 때만 보는 문서.

전제:

- `<directory>/tmp/validation-status.json` 존재
- `results.intent-validator == PASS`
- `overall == PASS || overall == WARN`
- 어떤 validator도 `FAIL`이면 PR 생성 금지

절차:

1. validation-status 확인
2. 현재 브랜치와 타겟 브랜치 결정
3. `git push -u origin <branch>`
4. `gh pr create`

PR 본문 최소 구성:

- `Summary`
- `Changes`
- `Test Plan`
- `Validation`

실패 시:

- validation 미통과면 중단
- `/commit-and-verify` 재실행 안내
