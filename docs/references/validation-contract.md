# Validation Contract

`/commit-and-verify`가 `validation-status.json`을 쓸 때만 보는 문서.

파일:

- 출력 경로: `<directory>/tmp/validation-status.json`
- 스키마: `schemas/validation-status.schema.json`

필수 필드:

- `timestamp`
- `branch`
- `base_branch`
- `commits`
- `results`
- `overall`
- `warnings`
- `errors`

`results` 필수 키:

- `intent-validator`
- `doc-validator`
- `security-validator`
- `code-simplifier`
- `test-validator`

선택 키:

- `cli-validator`
- `visual-qa`

상태값:

- 일반 validator: `PASS|WARN|FAIL|SKIP`
- `visual-qa`: `PASS|WARN|FAIL|SKIP|PENDING`

overall 판정:

- 하나라도 `FAIL`이면 `FAIL`
- `FAIL` 없이 `WARN`이 있으면 `WARN`
- 나머지는 `PASS`

추가 규칙:

- 1단계 intent 검증이 `FAIL`이면 2단계 validator는 모두 `SKIP`
- Subagent는 파일을 쓰지 않고 JSON 텍스트만 반환
- 메인 명령만 `validation-status.json`을 생성
