---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read
description: 현재 브랜치의 작업 컨텍스트 확인. 브랜치에서 이슈 번호를 뽑아 GitHub Issue와 Notion Task/Story/Project를 함께 보여줌
---

# 현재 브랜치의 작업 컨텍스트 확인

현재 git 브랜치에서 이슈 번호를 추출하고, **GitHub 이슈 + Notion Task/Story/Project** 정보를 함께 보여줍니다.

## 데이터 소스

- **Github**: `gh` CLI
- **Task DB**: `b89060b1-037c-480d-8671-f206aec117b6`
- **Story DB**: `338b9757-d10f-462f-92c9-4777cb747c78`
- **Project DB**: `0848664d-6ecf-441e-b3d5-6b1f4fd540f8`

## 실행

```bash
node ~/.codex/scripts/ult-notion.mjs issue
```

스크립트가 처리하는 것:
- 현재 브랜치에서 Issue 번호 추출
- GitHub Issue 조회
- Notion Task를 Issue URL 정확 일치로 조회 (없으면 Story 도 같은 방식으로 조회)
- 연결된 Story, Project, Repository 조회 (Issue Number / Working Time / Work Progress 등 계산 속성 포함)
- Task/Story가 없으면 GitHub 정보만 출력하고 연결 복구 명령 안내

## 출력 형식

스크립트 출력을 그대로 보여준다:

```
### Issue #<번호>: <제목>

- **상태**: <open/closed>
- **브랜치**: <branch>
- **URL**: <github_url>
- **작성자**: <author>
- **라벨**: <labels>
- **담당자**: <assignees>

#### 본문
<body>

---

### 📋 Notion Task

- **이름**: <task_name>
- **상태**: <task_status>
- **Topic**: <topic>
- **Planned Date**: <planned_date_range>
- **Working Time**: <working_time>h (계획 <planned_time>h, On Time Rate <rate>%)
- **First Commit**: <first_commit_date>
- **Last Commit**: <last_commit_date>
- **Repository**: <repository>

#### 📜 Story: <story_title>
- **Tag**: <tag>
- **Priority**: <priority>
- **Status**: <status>
- **Work Progress**: <progress>% (이 Story 내 다른 Task 진행도 합산)

#### 🛡️ Project: <project_title>
- **Manager**: <manager>
- **Duration**: <duration>
- **Status**: <status>
- **Work Progress**: <progress>%

---

#### 코멘트 (Github)
시간순 정리:
- **<author>** (<date>): <body>
```

## 컨텍스트 안내

스크립트 출력 뒤에 한 줄 요약을 추가한다:
```
이 작업은 [<Project>] 의 [<Story>] 일부로, 마감 D-<n>일입니다.
```

## 주의

- Task가 Notion에 없으면 GitHub 정보만 출력하고 `/ult-task-link-issue` 를 안내한다
- Task 는 Issue URL 이 채워져 있어야 찾을 수 있다
