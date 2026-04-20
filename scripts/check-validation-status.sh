#!/bin/bash
# validation-status.json 계약 검증기
# Usage:
#   scripts/check-validation-status.sh <json-file>

set -euo pipefail

TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "Usage: $0 <json-file>" >&2; exit 1; }
[ -f "$TARGET" ] || { echo "ERROR: file not found: $TARGET" >&2; exit 1; }

jq -e '
  def is_validation_result:
    . == "PASS" or . == "WARN" or . == "FAIL" or . == "SKIP";
  def is_visual_result:
    is_validation_result or . == "PENDING";
  (.timestamp | type == "string") and
  (.branch | type == "string") and
  (.base_branch | type == "string") and
  (.commits | type == "array") and
  (all(.commits[]; (.hash | type == "string") and (.hash | test("^[a-f0-9]{7,40}$")) and (.message | type == "string"))) and
  (.results | type == "object") and
  (.results["intent-validator"] | is_validation_result) and
  (.results["doc-validator"] | is_validation_result) and
  (.results["security-validator"] | is_validation_result) and
  (.results["code-simplifier"] | is_validation_result) and
  (.results["test-validator"] | is_validation_result) and
  ((.results["cli-validator"] // "SKIP") | is_validation_result) and
  ((.results["visual-qa"] // "SKIP") | is_visual_result) and
  (.overall | . == "PASS" or . == "WARN" or . == "FAIL") and
  (.warnings | type == "array") and
  (all(.warnings[]; type == "string")) and
  (.errors | type == "array") and
  (all(.errors[]; type == "string"))
' "$TARGET" >/dev/null

echo "OK: validation-status contract matches schema-compatible expectations"
