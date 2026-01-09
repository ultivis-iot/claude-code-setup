# Claude Code 개발 플로우 설치 스크립트 (Windows PowerShell)
# 사용법: .\setup.ps1

$ErrorActionPreference = "Stop"

# UTF-8 코드 페이지 설정 (한글 깨짐 방지)
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Claude Code 개발 플로우 설치" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# 디렉토리 생성
Write-Host "1. 디렉토리 생성..."
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir "agents") | Out-Null

# CLAUDE.md 설치
Write-Host "2. CLAUDE.md 설치..."
$ClaudeMdPath = Join-Path $ClaudeDir "CLAUDE.md"
$Marker = "# === Claude Code 개발 플로우 설정 ==="
$SourceClaudeMd = Join-Path $ScriptDir "CLAUDE.md"

if (Test-Path $ClaudeMdPath) {
    $Content = Get-Content $ClaudeMdPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($Content -and $Content.Contains($Marker)) {
        Write-Host "   이미 설치된 설정 발견. 건너뜀" -ForegroundColor Yellow
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

# Plugins 설치
Write-Host "6. Plugins 설치..."
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

Write-Host ""
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "설치 완료!" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "설치된 파일:"
Write-Host "  ~/.claude/CLAUDE.md (기존 파일에 추가됨)"
Write-Host "  ~/.claude/commands/commit-and-verify.md"
Write-Host "  ~/.claude/commands/create-pr.md"
Write-Host "  ~/.claude/agents/intent-validator.md"
Write-Host "  ~/.claude/agents/doc-validator.md"
Write-Host "  ~/.claude/agents/security-validator.md"
Write-Host "  ~/.claude/agents/code-simplifier.md"
Write-Host "  ~/.claude/schemas/validation-status.schema.json"
Write-Host "  ~/.claude/plugins/security-guidance/ (보안 검사 Hook)"
Write-Host ""
Write-Host "사용 방법:"
Write-Host "  1. Plan 모드 진입: Shift+Tab 두 번"
Write-Host "  2. 구현 후 커밋+검증: /commit-and-verify"
Write-Host "  3. PR 생성: /create-pr"
Write-Host ""
Write-Host "프로젝트별 필요 사항:"
Write-Host "  mkdir tmp  # 프로젝트 루트에 tmp 디렉토리 생성"
