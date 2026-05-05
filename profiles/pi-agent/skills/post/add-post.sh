#!/bin/bash
# add-post.sh — Ajouter un post dans la DB de Gontrand via psql
# Usage: add-post.sh <platform> <title> <body>
#        ou: add-post.sh --help

set -euo pipefail

POSTGRES_USER="gontrand"
POSTGRES_DB="gontrand"
POSTGRES_HOST="localhost"

# Default user ID (Rodolphe)
DEFAULT_USER_ID="a3d8ad89-2583-4ff5-84e0-a8b3a9f1dabd"

HELP_TEXT="
Usage: add-post.sh <platform> <title> <body>

Options:
  --help          Show this help
  --dry-run       Show SQL without executing
  --verbose       Show SQL being executed
  --user <id>     Override user_id (default: a3d8ad89-2583-4ff5-84e0-a8b3a9f1dabd)

Platforms: linkedin, x, threads, reddit

Example:
  add-post.sh linkedin \"Titre du post\" \"Contenu du post...\"

Or from stdin:
  echo 'linkedin|Titre|Contenu' | add-post.sh
"

# Parse arguments
DRY_RUN=false
VERBOSE=false
USER_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      echo "$HELP_TEXT"
      exit 0
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --user)
      USER_ID="${2:-}"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

PLATFORM="${1:-}"
TITLE="${2:-}"
BODY="${3:-}"

if [[ -z "$PLATFORM" || -z "$TITLE" || -z "$BODY" ]]; then
  echo "Error: platform, title, and body are required"
  echo "$HELP_TEXT"
  exit 1
fi

# Validate platform
case "$PLATFORM" in
  linkedin|x|threads|reddit) ;;
  *)
    echo "Error: Invalid platform '$PLATFORM'. Use: linkedin, x, threads, reddit"
    exit 1
    ;;
esac

# Use provided user_id or default to Rodolphe's UUID
USER_ID="${USER_ID:-$DEFAULT_USER_ID}"

# Escape single quotes in title/body for SQL
escape_sql() {
  echo "$1" | sed "s/'/''/g"
}

ESCAPED_TITLE=$(escape_sql "$TITLE")
ESCAPED_BODY=$(escape_sql "$BODY")

# Generate SQL
SQL="INSERT INTO posts (platform, title, body, status, created_by_id, updated_by_id, created_at, updated_at)
VALUES ('${PLATFORM}', '${ESCAPED_TITLE}', '${ESCAPED_BODY}', 'draft', '${USER_ID}', '${USER_ID}', now(), now())"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Would execute:"
  echo "$SQL"
  echo ""
  echo "Platform: $PLATFORM"
  echo "Title: $TITLE"
  echo "User ID: $USER_ID"
  exit 0
fi

if [[ "$VERBOSE" == "true" ]]; then
  echo "Executing:"
  echo "$SQL"
  echo ""
fi

# Execute
echo "Adding post..."
echo "Platform: $PLATFORM"
echo "Title: $TITLE"
echo "User ID: $USER_ID"
echo ""

sudo podman exec gontrand-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -h "$POSTGRES_HOST" \
  -c "$SQL"

if [[ $? -eq 0 ]]; then
  echo ""
  echo "✓ Post added successfully (status: draft)"
  echo "  Next: Run PATCH /api/posts/<id> with {\"status\":\"available\"} to publish"
else
  echo "✗ Failed to add post"
  exit 1
fi
