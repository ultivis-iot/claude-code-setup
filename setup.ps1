# Claude Code 개발 플로우 설치 스크립트 (Windows PowerShell)
# 사용법: .\setup.ps1 [-Update]

param(
    [switch]$Update
)

$ErrorActionPreference = "Stop"

# UTF-8 코드 페이지 설정 (한글 깨짐 방지)
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"

Write-Host "===================================" -ForegroundColor Cyan
if ($Update) {
    Write-Host "Claude Code 개발 플로우 업데이트" -ForegroundColor Cyan
} else {
    Write-Host "Claude Code 개발 플로우 설치" -ForegroundColor Cyan
}
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# 디렉토리 생성
Write-Host "1. 디렉토리 생성..."
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "agents") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "skills") | Out-Null

# CLAUDE.md 설치
Write-Host "2. CLAUDE.md 설치..."
$ClaudeMdPath = Join-Path $ClaudeDir "CLAUDE.md"
$Marker = "# === Claude Code 개발 플로우 설정 ==="
$SourceClaudeMd = Join-Path $ScriptDir "templates\global-claude.md"

if (Test-Path $ClaudeMdPath) {
    $Content = Get-Content $ClaudeMdPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($Content -and $Content.Contains($Marker)) {
        if ($Update) {
            # 업데이트 모드: 기존 설정 섹션 교체
            Write-Host "   기존 설정 섹션 업데이트" -ForegroundColor Yellow
            # MARKER 이전 내용만 유지
            $MarkerIndex = $Content.IndexOf($Marker)
            $BeforeMarker = $Content.Substring(0, $MarkerIndex)
            # 새 내용으로 교체
            $NewContent = $BeforeMarker + $Marker + "`n" + (Get-Content $SourceClaudeMd -Raw -Encoding UTF8)
            Set-Content -Path $ClaudeMdPath -Value $NewContent -Encoding UTF8 -NoNewline
            Write-Host "   CLAUDE.md 업데이트 완료" -ForegroundColor Green
        } else {
            Write-Host "   이미 설치된 설정 발견. 건너뜀 (업데이트: -Update)" -ForegroundColor Yellow
        }
    } else {
        Add-Content -Path $ClaudeMdPath -Value "`n$Marker" -Encoding UTF8
        Get-Content $SourceClaudeMd -Encoding UTF8 | Add-Content -Path $ClaudeMdPath -Encoding UTF8
        Write-Host "   CLAUDE.md에 설정 추가 완료" -ForegroundColor Green
    }
} else {
    Set-Content -Path $ClaudeMdPath -Value $Marker -Encoding UTF8
    Get-Content $SourceClaudeMd -Encoding UTF8 | Add-Content -Path $ClaudeMdPath -Encoding UTF8
    Write-Host "   CLAUDE.md 생성 완료" -ForegroundColor Green
}

# Commands 설치
Write-Host "3. Commands 설치..."
$CommandsSource = Join-Path $ScriptDir "commands"
$CommandsDest = Join-Path $ClaudeDir "commands"
if (Test-Path $CommandsSource) {
    Get-ChildItem -Path $CommandsSource -Filter "*.md" | ForEach-Object {
        Copy-Item $_.FullName -Destination $CommandsDest -Force
        Write-Host "   $($_.Name)" -ForegroundColor Green
    }
}

# Agents 설치
Write-Host "4. Agents 설치..."
$AgentsSource = Join-Path $ScriptDir "agents"
$AgentsDest = Join-Path $ClaudeDir "agents"
if (Test-Path $AgentsSource) {
    Get-ChildItem -Path $AgentsSource -Filter "*.md" | ForEach-Object {
        Copy-Item $_.FullName -Destination $AgentsDest -Force
        Write-Host "   $($_.Name)" -ForegroundColor Green
    }
}

# Skills 설치
Write-Host "4-1. Skills 설치..."
$SkillsSource = Join-Path $ScriptDir "codex\skills"
$SkillsDest = Join-Path $ClaudeDir "skills"
if (Test-Path $SkillsSource) {
    Get-ChildItem -Path $SkillsSource -Directory | Where-Object {
        Test-Path (Join-Path $_.FullName "SKILL.md")
    } | ForEach-Object {
        $DestSkillPath = Join-Path $SkillsDest $_.Name
        if (Test-Path $DestSkillPath) {
            Remove-Item $DestSkillPath -Recurse -Force
        }
        Copy-Item $_.FullName -Destination $DestSkillPath -Recurse -Force
        Write-Host "   $($_.Name)" -ForegroundColor Green
    }
}

# Schemas 설치
Write-Host "5. Schemas 설치..."
$SchemasSource = Join-Path $ScriptDir "schemas"
$SchemasDest = Join-Path $ClaudeDir "schemas"
if (Test-Path $SchemasSource) {
    New-Item -ItemType Directory -Force -Path $SchemasDest | Out-Null
    Get-ChildItem -Path $SchemasSource -Filter "*.json" | ForEach-Object {
        Copy-Item $_.FullName -Destination $SchemasDest -Force
        Write-Host "   $($_.Name)" -ForegroundColor Green
    }
}

# Scripts 설치
Write-Host "6. Scripts 설치..."
$ScriptsSource = Join-Path $ScriptDir "scripts"
$ScriptsDest = Join-Path $ClaudeDir "scripts"
if (Test-Path $ScriptsSource) {
    New-Item -ItemType Directory -Force -Path $ScriptsDest | Out-Null
    Get-ChildItem -Path $ScriptsSource -Filter "*.sh" | ForEach-Object {
        Copy-Item $_.FullName -Destination $ScriptsDest -Force
        Write-Host "   $($_.Name)" -ForegroundColor Green
    }
}

# 구버전 파일 정리
# 이 목록에는 과거에 이 저장소가 설치했다가 rename/제거된 파일만 넣는다.
# (~/.claude에 사용자가 직접 만든 로컬 전용 파일은 건드리지 않는다)
Write-Host "6-1. 구버전 파일 정리..."
$StaleFiles = @(
    "commands\isaac-my-tasks.md",
    "commands\isaac-story-create.md",
    "commands\isaac-task-create.md",
    "commands\isaac-task-note.md",
    "commands\isaac-task-status.md",
    "commands\isaac-weekly-report.md",
    "scripts\isaac-my-tasks.sh",
    "scripts\isaac-story-create-exec.sh",
    "scripts\isaac-task-note.sh",
    "scripts\isaac-task-status.sh",
    "scripts\isaac-weekly-collect.sh",
    "scripts\isaac-weekly-publish.sh",
    "scripts\isaac-wt-add.sh"
)
$StaleRemoved = 0
foreach ($RelPath in $StaleFiles) {
    $StaleTarget = Join-Path $ClaudeDir $RelPath
    if (Test-Path $StaleTarget) {
        Remove-Item $StaleTarget -Force
        Write-Host "   제거: $RelPath" -ForegroundColor Green
        $StaleRemoved++
    }
}
if ($StaleRemoved -eq 0) {
    Write-Host "   정리할 구버전 파일 없음" -ForegroundColor Green
}

# Plugins 설치
Write-Host "7. Plugins 설치..."
$PluginsSource = Join-Path $ScriptDir "plugins"
$PluginsDest = Join-Path $ClaudeDir "plugins"
if (Test-Path $PluginsSource) {
    New-Item -ItemType Directory -Force -Path $PluginsDest | Out-Null
    Get-ChildItem -Path $PluginsSource -Directory | ForEach-Object {
        $DestPluginPath = Join-Path $PluginsDest $_.Name
        Copy-Item $_.FullName -Destination $DestPluginPath -Recurse -Force
        Write-Host "   $($_.Name)" -ForegroundColor Green
    }
}

# Notion MCP 설정
Write-Host "8. Notion MCP 설정..."
$ClaudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if (-not $ClaudeCmd) {
    Write-Host "   claude CLI를 찾을 수 없어 Notion MCP 등록을 건너뜁니다." -ForegroundColor Yellow
} else {
    $McpList = & claude mcp list 2>$null
    if ($McpList -match "(?m)^notion-api:") {
        Write-Host "   notion-api MCP가 이미 등록됨" -ForegroundColor Green
    } elseif (-not $Update) {
        Write-Host ""
        Write-Host "   Notion 워크스페이스 연결을 위해 Internal Integration 토큰이 필요합니다."
        Write-Host "   발급 방법:"
        Write-Host "     1. https://www.notion.so/profile/integrations 접속"
        Write-Host "     2. + New integration → 회사 워크스페이스 선택, Type: Internal"
        Write-Host "     3. 생성 후 Internal Integration Secret 복사"
        Write-Host "     4. 접근할 페이지에서 ··· → Connections로 integration 공유"
        Write-Host ""
        $TokenSecure = Read-Host "   NOTION_TOKEN (건너뛰려면 Enter)" -AsSecureString
        $Bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($TokenSecure)
        $NotionToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($Bstr)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr) | Out-Null

        if ($NotionToken) {
            $AddResult = & claude mcp add -s user -e "NOTION_TOKEN=$NotionToken" notion-api -- npx -y `@notionhq/notion-mcp-server 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "   notion-api MCP 등록 완료 (user scope)" -ForegroundColor Green
                Write-Host "   Claude Code 재시작 후 mcp__notion-api__* 도구 사용 가능" -ForegroundColor Yellow
            } else {
                Write-Host "   notion-api MCP 등록 실패. 수동 등록 필요" -ForegroundColor Yellow
            }
            $NotionToken = $null
        } else {
            Write-Host "   건너뜀. 나중에 등록하려면:" -ForegroundColor Yellow
            Write-Host "     claude mcp add -s user -e NOTION_TOKEN=<token> notion-api -- npx -y @notionhq/notion-mcp-server"
        }
    } else {
        Write-Host "   notion-api 미등록 (업데이트 모드에서는 자동 등록 안 함)" -ForegroundColor Yellow
    }
}

# Notion cache 준비
Write-Host "9. Notion cache 준비..."
$NotionCacheDir = Join-Path $ClaudeDir "notion-cache"
New-Item -ItemType Directory -Force -Path $NotionCacheDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $NotionCacheDir "schemas") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $NotionCacheDir "templates") | Out-Null

$CacheRefreshScript = Join-Path $ScriptsDest "ult-cache-refresh.sh"
$BashCmd = Get-Command bash -ErrorAction SilentlyContinue
if ($BashCmd -and (Test-Path $CacheRefreshScript)) {
    $PreviousWorkflowHome = $env:WORKFLOW_HOME
    $env:WORKFLOW_HOME = $ClaudeDir
    $CacheRefreshOutput = & bash "$CacheRefreshScript" --quiet 2>&1
    $CacheRefreshExit = $LASTEXITCODE
    if ($null -eq $PreviousWorkflowHome) {
        Remove-Item Env:\WORKFLOW_HOME -ErrorAction SilentlyContinue
    } else {
        $env:WORKFLOW_HOME = $PreviousWorkflowHome
    }

    $CacheRefreshText = ($CacheRefreshOutput | Out-String)
    if ($CacheRefreshText -match "(?m)^DONE:") {
        Write-Host "   ~/.claude/notion-cache 준비 완료" -ForegroundColor Green
    } elseif ($CacheRefreshText -match "(?m)^SKIP:") {
        Write-Host "   건너뜀. Notion token 설정 후 첫 Notion 명령 실행 시 cache가 생성됩니다." -ForegroundColor Yellow
    } elseif ($CacheRefreshExit -ne 0) {
        Write-Host "   Notion cache refresh 실패. 첫 Notion 명령 실행 시 다시 시도됩니다." -ForegroundColor Yellow
    } else {
        Write-Host "   ~/.claude/notion-cache 디렉토리 준비 완료" -ForegroundColor Green
    }
} else {
    Write-Host "   ~/.claude/notion-cache 디렉토리 준비 완료" -ForegroundColor Green
    Write-Host "   bash를 찾을 수 없어 cache warm-up은 건너뜁니다." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "설치 완료!" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "설치된 파일:"
Write-Host "  ~/.claude/CLAUDE.md (기존 파일에 추가됨)"
Write-Host "  ~/.claude/commands/commit-and-verify.md"
Write-Host "  ~/.claude/commands/create-pr.md"
Write-Host "  ~/.claude/commands/review-cycle.md"
Write-Host "  ~/.claude/agents/intent-validator.md"
Write-Host "  ~/.claude/agents/doc-validator.md"
Write-Host "  ~/.claude/agents/security-validator.md"
Write-Host "  ~/.claude/agents/code-simplifier.md"
Write-Host "  ~/.claude/skills/*/SKILL.md"
Write-Host "  ~/.claude/schemas/validation-status.schema.json"
Write-Host "  ~/.claude/plugins/security-guidance/ (보안 검사 Hook)"
Write-Host "  ~/.claude/scripts/*.sh (workflow 실행 스크립트)"
Write-Host "  ~/.claude/notion-cache/ (Notion token 사용 가능 시 자동 준비)"
Write-Host "  notion-api MCP (Notion 토큰 입력 시 user scope 등록)"
Write-Host ""
Write-Host "사용 방법:"
Write-Host "  1. Plan 모드 진입: Shift+Tab 두 번"
Write-Host "  2. 구현 후 커밋+검증: /commit-and-verify"
Write-Host "  3. PR 생성: /create-pr"
Write-Host "  4. PR 리뷰 자동 반영: /review-cycle [PR번호]  (Ralph Loop 자동 시작)"
Write-Host "     내부 단일 라운드: /review-cycle [PR번호] --once"
Write-Host ""
Write-Host "프로젝트별 필요 사항:"
Write-Host "  mkdir tmp  # 프로젝트 루트에 tmp 디렉토리 생성"
