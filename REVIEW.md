# 리뷰 정책

이 저장소를 리뷰하는 사람·에이전트(로컬 검증, PR 기계 리뷰)가 같이 읽는다. 정책으로는 대상 브랜치(PR base)의 현재 파일을 쓴다. PR 이 이 파일을 바꾸면 그 변경은 리뷰 대상이고, 정책으로는 merge 뒤부터 쓴다.

## 이 저장소에서 실패란

- **설치기가 사용자 설정을 잃는다.** `setup.sh`·`setup.ps1`·`setup-codex.sh`·`scripts/install-*.mjs` 가 사용자의 `~/.claude/CLAUDE.md`·`settings.json`·hook 을 덮어쓰거나 지운다. `--update` 를 두 번 돌린 결과가 다르다.
- **문서가 거짓말한다.** `commands/`·`agents/`·`codex/skills/`·`docs/references/` 의 지시가 스크립트의 실제 동작·옵션·출력과 다르거나, 다른 문서와 모순된다. 여기서는 Markdown 이 곧 동작이다.
- **게이트가 실패를 통과로 보고한다.** `validation-gate.mjs`·`review-findings.mjs`·hook 이 검증하지 못한 것을 PASS·완료로 내보낸다(fail-open).
- **agent 가 권한 밖 일을 한다.** 검증 agent 가 파일을 쓰거나 다른 skill 을 부른다(`CLAUDE.md` 의 Agent 작성 규칙).
- 이 PR 이 `CLAUDE.md` 의 규칙을 어기거나, `CLAUDE.md` 의 줄을 사실과 다르게 만든다.

## 근거

- 지적마다 `파일:줄` 과 실패 시나리오(어떤 입력·상태에서 무엇이 잘못되는지)를 단다. 이름만 보고 추측하지 않는다.
- 이 PR 이 만들지 않은 문제는 기존 문제로 표시한다. 이 PR 에서 고치라고 요구하지 않는다.
- 같은 원인이 여러 곳에 있으면 한 지적에 위치를 모은다.

## 건너뛸 것

- `codex/plugins/dev-workflow/` — 생성본이다. 원본(`commands/`·`codex/skills/` 등)과 일치하는지는 `node scripts/sync-workflow.mjs --check` 가 맡는다.
- `tmp/`, `CHANGELOG.md` 의 문체.

## Nit

스타일·이름·정리 지적은 3건까지. 결함(defect) 지적과 섞지 않는다.

## 요약

첫 줄에 지적 수를 쓴다. 고칠 것이 없으면 "고칠 것 없음" 이라고 분명히 쓴다.
