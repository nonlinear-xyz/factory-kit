#!/usr/bin/env bash
# Measure the factory-kit's token footprint.
#
# Distinguishes:
#   - Baseline cost: skill/agent/command registry frontmatter
#   - Opt-in guidance cost: shared guidance plus the selected host adapter
#   - On-demand cost: what gets pulled in only when a skill is read, agent invoked, or command typed
#
# Token estimate uses ~4 chars per token (English-text rule of thumb). Real tokenizer counts
# may differ by 10-20% but the relative shape is what matters for trim decisions.

set -euo pipefail

KIT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"

# --- helpers ---

# Char count → token estimate (integer division)
to_tokens() { echo $(( $1 / 4 )); }

# Pretty-format a token count: 1234 → "1.2k", 950 → "950"
fmt() {
  local t="$1"
  if [[ "$t" -ge 1000 ]]; then
    awk -v t="$t" 'BEGIN{printf "%.1fk", t/1000}'
  else
    printf "%d" "$t"
  fi
}

file_chars() { wc -c < "$1" | tr -d ' '; }

# Chars between first two `---` lines, inclusive — what the host registers (the skill/agent/command list entry)
frontmatter_chars() {
  awk '
    /^---$/ {
      count++
      if (count == 1) { in_fm = 1; print; next }
      if (count == 2) { print; exit }
    }
    in_fm { print }
  ' "$1" | wc -c | tr -d ' '
}

# --- measure baseline ---

shared_guidance_chars=$( file_chars "${KIT_ROOT}/guidance/shared.md" )
claude_guidance_chars=$( file_chars "${KIT_ROOT}/guidance/claude.md" )
codex_guidance_chars=$( file_chars "${KIT_ROOT}/guidance/codex.md" )

agent_fm_total=0
agent_count=0
agent_body_total=0
declare -a agent_entries=()
shopt -s nullglob
for f in "${KIT_ROOT}"/agents/*.md; do
  agent_count=$(( agent_count + 1 ))
  agent_fm_total=$(( agent_fm_total + $( frontmatter_chars "$f" ) ))
  body=$( file_chars "$f" )
  agent_body_total=$(( agent_body_total + body ))
  agent_entries+=( "${body}|$( basename "$f" .md )" )
done

cmd_fm_total=0
cmd_count=0
cmd_body_total=0
declare -a cmd_entries=()
for f in "${KIT_ROOT}"/commands/*.md; do
  cmd_count=$(( cmd_count + 1 ))
  cmd_fm_total=$(( cmd_fm_total + $( frontmatter_chars "$f" ) ))
  body=$( file_chars "$f" )
  cmd_body_total=$(( cmd_body_total + body ))
  cmd_entries+=( "${body}|$( basename "$f" .md )" )
done

skill_total=0
skill_count=0
skill_fm_total=0
declare -a skill_entries=()
for f in "${KIT_ROOT}"/skills/*/SKILL.md; do
  skill_count=$(( skill_count + 1 ))
  skill_fm_total=$(( skill_fm_total + $( frontmatter_chars "$f" ) ))
  body=$( file_chars "$f" )
  skill_total=$(( skill_total + body ))
  skill_entries+=( "${body}|$( basename "$( dirname "$f" )" )" )
done
shopt -u nullglob

baseline_chars=$(( skill_fm_total + agent_fm_total + cmd_fm_total ))

# --- output ---

KIT_VERSION="$( cat "${KIT_ROOT}/VERSION" 2>/dev/null | tr -d '[:space:]' || echo "unknown" )"

echo "Factory-kit token footprint  (v${KIT_VERSION}, ~4 chars per token estimate)"
echo

echo "Baseline — loaded into every session"
printf "  %-32s %8s tokens   (%d canonical skills × frontmatter only)\n" "Skill registry entries" "$( fmt $( to_tokens "$skill_fm_total" ) )" "$skill_count"
printf "  %-32s %8s tokens   (%d agents × frontmatter only)\n" "Agent registry entries" "$( fmt $( to_tokens "$agent_fm_total" ) )" "$agent_count"
printf "  %-32s %8s tokens   (%d commands × frontmatter only)\n" "Command registry entries" "$( fmt $( to_tokens "$cmd_fm_total" ) )" "$cmd_count"
printf "  %-32s %8s tokens\n" "─ baseline total" "$( fmt $( to_tokens "$baseline_chars" ) )"
echo

echo "Opt-in managed guidance"
printf "  %-32s %8s tokens\n" "Shared guidance" "$( fmt $( to_tokens "$shared_guidance_chars" ) )"
printf "  %-32s %8s tokens\n" "Claude adapter" "$( fmt $( to_tokens "$claude_guidance_chars" ) )"
printf "  %-32s %8s tokens\n" "Codex adapter" "$( fmt $( to_tokens "$codex_guidance_chars" ) )"
echo

echo "On-demand — loaded only when invoked / read"
printf "  %-32s %8s tokens   (%d files, worst case if all read)\n" "Skills (full body)" "$( fmt $( to_tokens "$skill_total" ) )" "$skill_count"
printf "  %-32s %8s tokens   (%d agents, body loads in subagent context)\n" "Agents (full body)" "$( fmt $( to_tokens "$agent_body_total" ) )" "$agent_count"
printf "  %-32s %8s tokens   (%d commands)\n" "Commands (full body)" "$( fmt $( to_tokens "$cmd_body_total" ) )" "$cmd_count"
echo

echo "Heaviest skills (per-read cost)"
printf '%s\n' "${skill_entries[@]}" | sort -t'|' -k1 -rn | head -5 | while IFS='|' read -r c name; do
  printf "  %-32s %8s tokens\n" "$name" "$( fmt $( to_tokens "$c" ) )"
done
echo

echo "Heaviest agents (per-invoke boot cost)"
printf '%s\n' "${agent_entries[@]}" | sort -t'|' -k1 -rn | head -3 | while IFS='|' read -r c name; do
  printf "  %-32s %8s tokens\n" "$name" "$( fmt $( to_tokens "$c" ) )"
done
echo

echo "Heaviest commands (per-invoke cost)"
printf '%s\n' "${cmd_entries[@]}" | sort -t'|' -k1 -rn | head -3 | while IFS='|' read -r c name; do
  printf "  %-32s %8s tokens\n" "$name" "$( fmt $( to_tokens "$c" ) )"
done
echo

# Trim flags — outliers only, not "anything large"
echo "Trim candidates"
flagged=0
shared_guidance_tokens=$( to_tokens "$shared_guidance_chars" )
if (( shared_guidance_tokens > 2500 )); then
  echo "  - shared guidance is ${shared_guidance_tokens} tokens — every opted-in session pays this; consider trimming"
  flagged=$(( flagged + 1 ))
fi

# Median skill token count → outlier line is 2× median
median_skill_tokens=$(
  printf '%s\n' "${skill_entries[@]}" \
    | awk -F'|' '{ print $1 }' \
    | sort -n \
    | awk 'BEGIN{c=0} {a[c++]=$1} END{ if (c==0) print 0; else if (c%2==1) print a[int(c/2)]; else print int((a[c/2-1]+a[c/2])/2) }'
)
median_skill_tokens=$( to_tokens "$median_skill_tokens" )
outlier_threshold=$(( median_skill_tokens * 2 ))

while IFS='|' read -r c name; do
  t=$( to_tokens "$c" )
  if (( t > outlier_threshold )); then
    echo "  - ${name} is ${t} tokens (>2× median ${median_skill_tokens}) — likely two domains stapled together; consider splitting"
    flagged=$(( flagged + 1 ))
  fi
done < <( printf '%s\n' "${skill_entries[@]}" | sort -t'|' -k1 -rn )

if (( flagged == 0 )); then
  echo "  none — kit is balanced (median skill ${median_skill_tokens} tokens, no outliers)"
fi
