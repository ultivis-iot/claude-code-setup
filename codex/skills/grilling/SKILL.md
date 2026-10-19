---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

When `ultivis-flow` is installed, confirmed decisions become Plan inputs; do not create tracker records or begin implementation during the interview.

Plan 과정에서는 같은 설치 루트의 `docs/references/request-to-plan.md`를 따른다. 명시적인 심층 인터뷰는 아래 방식을 그대로 쓰고, 일반 요청에서는 코드·프로젝트 조사 후 남은 중요한 결정에 집중한다. 추천 이유와 대안의 영향을 설명하고 결정·이유·성공 사례·제외 범위·미결 사항을 Plan에 반영한다. 종료 시 팀이 확인할 동작 사례와 변경 경계를 요약한다.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask **at most three** frontier questions per round, the ones that unblock the most of the tree first; the rest wait for a later round. Number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), look it up yourself in the main session before asking; use a subagent only when the user has explicitly authorized delegation. Don't ask the user for anything you could look up yourself. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
