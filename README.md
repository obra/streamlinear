# streamlinear

Streamlined Linear integration for Claude Code. One tool, eight actions, zero bloat.

## Why?

The standard Linear MCP uses **~17,000 tokens** just for tool definitions. That's 8% of your context window before it does anything.

streamlinear uses **~500 tokens**. Same functionality, 34x lighter.

## Design Philosophy

Instead of 23 separate tools, streamlinear has **one tool with action dispatch**:

```json
{"action": "me"}
{"action": "help"}
{"action": "search"}
{"action": "get", "id": "ABC-123"}
{"action": "update", "id": "ABC-123", "state": "Done"}
{"action": "comment", "id": "ABC-123", "body": "Fixed!"}
{"action": "create", "title": "New bug", "team": "ENG"}
{"action": "graphql", "graphql": "query { viewer { name } }"}
```

## Actions

| Action | Purpose |
|--------|---------|
| `me` | Show your info, teams, and valid workflow states |
| `help` | Full documentation for all actions |
| `search` | Find issues (smart defaults: your active issues) |
| `get` | Issue details by ABC-123, URL, or UUID |
| `update` | Change state, priority, assignee |
| `comment` | Add comment to issue |
| `create` | Create new issue |
| `graphql` | Raw GraphQL for anything else |

## Installation

### As Claude Code Plugin

```bash
claude plugin add obra/streamlinear
```

Then set your Linear API token:
```bash
claude config set LINEAR_API_TOKEN lin_api_xxxxx
```

### Manual Setup

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "linear": {
      "command": "node",
      "args": ["/path/to/streamlinear/mcp/dist/index.js"],
      "env": {
        "LINEAR_API_TOKEN": "lin_api_xxxxx"
      }
    }
  }
}
```

## Smart Defaults

- `search` with no params → your assigned issues, not completed/canceled
- IDs accept ABC-123, Linear URLs, or UUIDs
- State names are fuzzy matched ("done" → "Done", "in prog" → "In Progress")
- `assignee: "me"` uses the authenticated user
- Error messages show valid options (states, teams)

## The GraphQL Escape Valve

For anything not covered by the main actions, use raw GraphQL:

```json
{
  "action": "graphql",
  "graphql": "query { projects { nodes { id name } } }"
}
```

Use `{"action": "help"}` for common GraphQL patterns.

## License

MIT
