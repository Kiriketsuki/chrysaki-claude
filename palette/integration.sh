# Chrysaki Claude integration palette.
# Layers statusline-specific colours on top of chrysaki-core tokens.
# chrysaki-core.sh must be sourced before this file.
#
# Core rule: application mappings live here, never in chrysaki-core.
# A CC_* value either references a CHRYSAKI_* token, or carries a local
# hex with a comment that names the nearest core token and the reason.

# Direct core mappings (exact matches with chrysaki-core v1.0.0)
CC_EMERALD_LT="$CHRYSAKI_EMERALD_LIGHT"   # #1a8a6a -- 5h normal, inbox
CC_SEC="$CHRYSAKI_TEXT_SECONDARY"          # #a0a4b8 -- 7d normal
CC_MUTED="$CHRYSAKI_TEXT_MUTED"            # #6a6e82 -- separators, reset timers

CC_TEAL="$CHRYSAKI_TEAL_LIGHT"       # #20969c -- ctx normal, issues
CC_BLONDE_LT="$CHRYSAKI_BLONDE_LIGHT" # #fcc96a -- unsynced commits
CC_WARN="$CHRYSAKI_BLONDE"            # #fbb13c -- >=50% warning
CC_ERROR="$CHRYSAKI_ERROR_LIGHT"      # #b53f4a -- >=75%/128k critical
CC_HEX_EMPTY="$CHRYSAKI_BORDER"       # #363a4f -- empty bar positions

# No core token exists for git diff colours. These stay integration-local.
CC_GREEN='#50b450'   # git insertions
CC_RED='#c05050'     # git deletions
