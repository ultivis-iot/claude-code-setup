# Matt Pocock Skills 도입 기준

원본: [mattpocock/skills](https://github.com/mattpocock/skills)

- 고정 커밋: `49dd158` (2026-10-09). 아래 표의 스킬 중 `grilling`·`grill-me`·`grill-with-docs`·`improve-codebase-architecture`·`wayfinder`·`tdd`·`domain-modeling`은 이 커밋 기준으로 다시 맞췄고, 나머지는 `e9fcdf95b402d360f90f1db8d776d5dd450f9234`(2026-07-16) 기준이다.
- 확인일: 2026-10-19
- 라이선스: MIT
- 원칙: `ultivis-flow`가 항상 lifecycle/tracker baseline이고, 아래 스킬은 독립 overlay로만 동작한다.

| 스킬 | 용도 | 기본 라우팅 | 우리 셋업 조정 |
|---|---|---|---|
| `tdd` | public seam 기준 red-green vertical slice | 자동 (테스트 환경이 있는 저장소의 버그 수정·로직·공개 인터페이스 변경. 화면 배치·스타일, 설정, 문서, 탐색용 코드 제외) | seam은 확인받지 않고 잡는 것·놓치는 것과 함께 밝힌 뒤 진행, green 뒤 리팩터링은 구현 에이전트가 하고 `commit-and-verify` Standards Review로 연결 |
| `diagnosing-bugs` | tight repro loop 기반 원인 진단 | 자동 | 해결 후 회귀 테스트와 workflow 검증으로 복귀 |
| `research` | primary source 기반 조사 | 자동 | subagent는 명시적 승인 시에만 사용 |
| `domain-modeling` | 용어, 불변식, GLOSSARY/ADR 정리 | 자동 | 승인된 Plan과 저장소 문서 관례 유지, 기존 `CONTEXT.md`만 있는 저장소는 그 파일을 그대로 사용 |
| `codebase-design` | deep module, interface, seam 설계 | 자동 | `ultivis-flow`의 설계 overlay로 사용 |
| `improve-codebase-architecture` | 구조 개선 후보 탐색과 시각 보고서 | 명시 호출 | 탐색은 main session, subagent는 승인 시에만, 구현은 `ultivis-flow` Plan 승인 뒤 |
| `wayfinder` | foggy multi-session effort의 decision map | 자동 (Plan 분해 단계에서 추천) | Notion Story → Notion Task + GitHub Issue, Parent Task dependency, 티켓 유형은 본문 `## Type`, 조사부터 구현까지 같은 티켓 |
| `resolving-merge-conflicts` | merge/rebase conflict 의도 보존 해결 | 자동 | 완료 후 `commit-and-verify` 재실행 |
| `grilling` | design tree frontier를 라운드로 묻는 계획/설계 인터뷰 | 자동 | 라운드당 최대 3개, 사실 확인은 main session, 결정을 Plan 입력으로 넘기고 인터뷰 중 구현 금지 |
| `grill-me` | grilling 명시 호출 단축 진입점 | 명시 호출 | router는 `grilling`을 직접 선택 |
| `grill-with-docs` | grilling + domain-modeling 단축 진입점 | 명시 호출 | 결정을 GLOSSARY와 ADR로 남김 |
| `handoff` | 다음 세션용 압축 인수인계 | 자동 | `tmp/story-handoff.*`를 대체하지 않고 링크 |
| `teach` | 상태를 축적하는 장기 학습 | 자동 | 개발 repo가 아닌 전용 teaching workspace에서만 기록 |
| `writing-great-skills` | 예측 가능한 skill 작성 원칙 | 자동 | Codex `skill-creator` 지침과 함께 사용 |

`ask-matt`, `implement`, `code-review`는 별도 스킬로 설치하지 않는다. 라우팅은 `ultivis-flow`가 담당하고, 표준 리뷰 원칙은 기존 검증 계약에 흡수한다. `prototype`은 이번 도입 범위에서 제외하며, `wayfinder`는 설치 여부에 따라 임시 artifact 방식으로 fallback한다.

## MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
