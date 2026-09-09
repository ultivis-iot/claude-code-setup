# PR 생성 계약

Claude/Codex 공통 PR 절차의 원본이다. 실행 전에 읽는다.
`WF`와 저장소/target 결정 기준은 같은 디렉터리의 `validation-contract.md`를 따른다.

1. 현재 브랜치·원격을 확인하고 `git fetch origin --prune`로 기준 ref를 갱신한다.
2. 명시된 target, 없으면 `dev`, 없으면 원격 default branch를 선택한다. 현재 브랜치와 target이 같으면 중단한다.
3. 아래 명령이 성공해야 push/PR을 진행한다. 실패하면 검증 계약으로 돌아간다.

```bash
node "$WF/scripts/validation-gate.mjs" ready tmp/validation-status.json --repo <repo> --base origin/<target>
```

4. `git push -u origin <branch>`로 검증된 브랜치만 push한다. 설치된 pre-push hook도 동일한 실행기를 사용한다.
5. 현재 remote head가 검증한 `snapshot.head_sha`와 같은지 확인한다. `gh pr create --base <target> --head <branch> --body-file <body.md>`를 실행한다. 자동 선택한 target도 항상 명시적으로 넘긴다.
6. PR 본문에는 해결한 문제와 변경 후 동작, 실제 수행한 검증, 남은 제한을 쓴다. repository PR template이 있으면 따른다.
7. Task 연동이 요청된 흐름이면 해당 Notion Task의 PR URL을 동기화한다. Story PR은 만들지 않는다.

이미 같은 head/base의 PR이 있으면 해당 PR을 반환하고 중복 생성하지 않는다.
실패한 push/PR 생성은 원인을 확인하고 기존 권한 안에서 복구한다. 다른 대상에 게시하는 방식으로 우회하지 않는다.
검증 상태를 읽기만 하고 모델이 준비 완료를 판정하거나, 오래된 결과의 SHA를 수정해서 재사용하지 않는다.

선택적 Git hook 설치: 이 설정 저장소의 `hooks/install-hooks.sh`를 대상 저장소에서 실행한다.
커밋은 허용하고, 검증되지 않은 push는 차단한다. hook은 로컬 방어선이며 `--no-verify`로 우회할 수 있으므로 서버 측 강제가 필요하면 보호 브랜치/CI도 같은 게이트 계약을 적용해야 한다.
