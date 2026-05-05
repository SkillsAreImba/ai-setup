---
name: post
description: Create LinkedIn/X/Threads/Reddit posts via API. Trigger when asked to draft or publish a social post. Skip for generic writing requests without platform/context.
---

## Workflow

### Step 1: Extract post details
Ask user for:
- **Platform** : linkedin / x / threads / reddit (default: linkedin)
- **Title** : headline (optional for LinkedIn)
- **Body** : full post content
- **CTA** : call-to-action (optional)

### Step 2: Generate post
Use AI to craft:
- Strong hook (first 2 lines)
- Clear value proposition
- Engagement-friendly formatting (short paragraphs, whitespace)
- Platform-appropriate tone (LinkedIn = professional, X = concise, etc.)
- Relevant hashtags (max 3-5 for LinkedIn, 1-2 for X)

### Step 3: Verify & post
- Show draft to user for approval
- If approved, execute curl via bash tool:
```bash
curl -X POST http://127.0.0.1:8080/api/posts \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "linkedin",
    "title": "...",
    "body": "..."
  }'
```
- **Use the proper script**: `./add-post.sh <platform> <title> <body>`
- The script:
  - Uses valid enum values only: 'draft', 'available', 'deleted'
  - Always uses 'draft' status (you must call PATCH /api/posts/{id} with status: 'available' to publish)
  - Properly escapes SQL to prevent injection
- Example:
```bash
./add-post.sh linkedin "Title of Post" "Body of Post..."```
```

### Step 4: Confirm
Return:
- Post ID
- Platform
- Status (draft/pending)
- Next step (review → publish via PATCH /api/posts/{id} with status: available)

## Rules
- Default platform is linkedin unless specified
- Keep LinkedIn posts under 3000 characters
- Always show draft before posting
- **ALWAYS use the script**: `./add-post.sh <platform> <title> <body>`
- NEVER use raw SQL directly
- The script uses valid enum values: 'draft' (hardcoded), 'available', 'deleted'

## Example
User: "Crée un post LinkedIn sur l'IA et le minimalisme"
→ Ask for title/body specifics OR generate directly if context is clear
→ Show draft → Post via psql → Return ID and confirmation
