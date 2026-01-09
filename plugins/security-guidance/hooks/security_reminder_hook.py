#!/usr/bin/env python3
"""
Security Reminder Hook for Claude Code
Warns about potential security issues when editing files.
"""

import json
import os
import sys
import re
import hashlib
import time
from pathlib import Path

# Security patterns to check
SECURITY_PATTERNS = {
    "github_actions": {
        "path_pattern": r"\.github/workflows/.*\.ya?ml$",
        "warning": "GitHub Actions 워크플로우 파일입니다. 신뢰할 수 없는 입력을 직접 사용하면 명령 주입 위험이 있습니다."
    },
    "child_process_exec": {
        "content_pattern": r"child_process\.exec\s*\(",
        "warning": "child_process.exec() 사용이 감지되었습니다. 셸 명령 주입 취약점 방지를 위해 execFile() 사용을 권장합니다."
    },
    "eval_function": {
        "content_pattern": r"\beval\s*\(",
        "warning": "eval() 사용이 감지되었습니다. 임의 코드 실행 위험이 있으므로 사용을 피하세요."
    },
    "new_function": {
        "content_pattern": r"new\s+Function\s*\(",
        "warning": "new Function() 사용이 감지되었습니다. eval()과 유사한 보안 위험이 있습니다."
    },
    "dangerous_inner_html": {
        "content_pattern": r"dangerouslySetInnerHTML",
        "warning": "dangerouslySetInnerHTML 사용이 감지되었습니다. XSS 방지를 위해 입력값 새니타이제이션이 필요합니다."
    },
    "inner_html": {
        "content_pattern": r"\.innerHTML\s*=",
        "warning": "innerHTML 직접 할당이 감지되었습니다. XSS 방지를 위해 textContent 또는 새니타이제이션을 사용하세요."
    },
    "document_write": {
        "content_pattern": r"document\.write\s*\(",
        "warning": "document.write() 사용이 감지되었습니다. XSS 취약점 위험이 있습니다."
    },
    "pickle_python": {
        "content_pattern": r"\bpickle\.(load|loads|dump|dumps)\s*\(",
        "warning": "pickle 사용이 감지되었습니다. 신뢰할 수 없는 데이터 역직렬화는 위험합니다. JSON 사용을 권장합니다."
    },
    "os_system": {
        "content_pattern": r"\bos\.system\s*\(",
        "warning": "os.system() 사용이 감지되었습니다. subprocess 모듈 사용을 권장합니다."
    },
    "sql_string_format": {
        "content_pattern": r"(SELECT|INSERT|UPDATE|DELETE).*(%s|{.*}|' ?\+)",
        "warning": "SQL 문자열 조합이 감지되었습니다. SQL Injection 방지를 위해 파라미터화된 쿼리를 사용하세요."
    }
}

def get_state_file():
    """Get the state file path for tracking shown warnings."""
    state_dir = Path.home() / ".claude" / "security-guidance-state"
    state_dir.mkdir(parents=True, exist_ok=True)

    # Clean up old state files (older than 30 days)
    for f in state_dir.glob("*.json"):
        if time.time() - f.stat().st_mtime > 30 * 24 * 3600:
            f.unlink()

    session_id = os.environ.get("CLAUDE_SESSION_ID", "default")
    return state_dir / f"{session_id}.json"

def load_state():
    """Load the state of shown warnings."""
    state_file = get_state_file()
    if state_file.exists():
        try:
            return json.loads(state_file.read_text())
        except:
            return {"shown_warnings": []}
    return {"shown_warnings": []}

def save_state(state):
    """Save the state of shown warnings."""
    state_file = get_state_file()
    state_file.write_text(json.dumps(state))

def get_warning_hash(file_path, pattern_name):
    """Generate a hash for a warning to track if it's been shown."""
    return hashlib.md5(f"{file_path}:{pattern_name}".encode()).hexdigest()

def check_security_issues(file_path, content):
    """Check for security issues in the file."""
    warnings = []

    for pattern_name, pattern_info in SECURITY_PATTERNS.items():
        # Check path pattern
        if "path_pattern" in pattern_info:
            if re.search(pattern_info["path_pattern"], file_path):
                warnings.append({
                    "name": pattern_name,
                    "warning": pattern_info["warning"]
                })
                continue

        # Check content pattern
        if "content_pattern" in pattern_info:
            if re.search(pattern_info["content_pattern"], content, re.IGNORECASE):
                warnings.append({
                    "name": pattern_name,
                    "warning": pattern_info["warning"]
                })

    return warnings

def main():
    # Read input from stdin
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        sys.exit(0)

    tool_input = input_data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    # Get content based on tool type
    content = ""
    if "content" in tool_input:
        content = tool_input["content"]
    elif "new_string" in tool_input:
        content = tool_input["new_string"]
    elif "edits" in tool_input:
        content = " ".join(edit.get("new_string", "") for edit in tool_input.get("edits", []))

    if not file_path or not content:
        sys.exit(0)

    # Check for security issues
    warnings = check_security_issues(file_path, content)

    if not warnings:
        sys.exit(0)

    # Load state to check for already shown warnings
    state = load_state()
    new_warnings = []

    for warning in warnings:
        warning_hash = get_warning_hash(file_path, warning["name"])
        if warning_hash not in state["shown_warnings"]:
            new_warnings.append(warning)
            state["shown_warnings"].append(warning_hash)

    if not new_warnings:
        sys.exit(0)

    # Save state
    save_state(state)

    # Output warnings
    print("\n⚠️  보안 경고:", file=sys.stderr)
    print(f"파일: {file_path}", file=sys.stderr)
    print("-" * 50, file=sys.stderr)
    for warning in new_warnings:
        print(f"• {warning['warning']}", file=sys.stderr)
    print("-" * 50, file=sys.stderr)
    print("", file=sys.stderr)

    # Return continue decision (warn but don't block)
    result = {
        "decision": "approve",
        "reason": "Security warnings have been shown to the user"
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
