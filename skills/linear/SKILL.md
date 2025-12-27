---
name: linear
description: Use when working with Linear issues, projects, and tasks. Single tool with action dispatch.
---

# Linear Integration

One tool (`linear`) with 6 actions for common operations plus a GraphQL escape valve.

## Quick Reference

### My Issues (Default)
```json
{"action": "search"}
```
Returns your assigned issues that aren't completed/canceled.

### Search by Text
```json
{"action": "search", "query": "authentication bug"}
```

### Search with Filters
```json
{"action": "search", "query": {"assignee": "me", "state": "In Progress"}}
{"action": "search", "query": {"team": "ENG", "priority": 1}}
{"action": "search", "query": {"state": "Todo", "assignee": "alice@example.com"}}
```

Filter options: `assignee` (email or "me"), `state`, `priority` (0-4), `team`

### Get Issue Details
```json
{"action": "get", "id": "ABC-123"}
{"action": "get", "id": "https://linear.app/workspace/issue/ABC-123"}
```

Accepts: issue identifier (ABC-123), Linear URL, or UUID.

### Update Issue
```json
{"action": "update", "id": "ABC-123", "state": "Done"}
{"action": "update", "id": "ABC-123", "priority": 1}
{"action": "update", "id": "ABC-123", "assignee": "me"}
{"action": "update", "id": "ABC-123", "assignee": null}
{"action": "update", "id": "ABC-123", "state": "In Progress", "priority": 2}
```

- `state`: Fuzzy matched ("done", "in prog", "todo", etc.)
- `priority`: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
- `assignee`: email, "me", or null to unassign

### Add Comment
```json
{"action": "comment", "id": "ABC-123", "body": "Fixed in commit abc123"}
```

### Create Issue
```json
{"action": "create", "title": "Fix login bug", "team": "ENG"}
{"action": "create", "title": "Add dark mode", "team": "ENG", "body": "User requested dark theme", "priority": 3}
```

Required: `title`, `team` (team key like "ENG" or team name)
Optional: `body`, `priority`, `labels`

## GraphQL Escape Valve

For anything not covered above, use raw GraphQL:

```json
{
  "action": "graphql",
  "graphql": "query { viewer { id name email } }"
}
```

With variables:
```json
{
  "action": "graphql",
  "graphql": "query($id: String!) { issue(id: $id) { title state { name } } }",
  "variables": {"id": "ABC-123"}
}
```

### Common GraphQL Patterns

**List projects:**
```json
{
  "action": "graphql",
  "graphql": "query { projects { nodes { id name state } } }"
}
```

**Get current cycle:**
```json
{
  "action": "graphql",
  "graphql": "query($teamId: String!) { team(id: $teamId) { activeCycle { id name startsAt endsAt } } }",
  "variables": {"teamId": "team-uuid"}
}
```

**List teams:**
```json
{
  "action": "graphql",
  "graphql": "query { teams { nodes { id key name } } }"
}
```

**Create project:**
```json
{
  "action": "graphql",
  "graphql": "mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { id name } } }",
  "variables": {"input": {"name": "Q1 Launch", "teamIds": ["team-id"]}}
}
```

**Add issue to project:**
```json
{
  "action": "graphql",
  "graphql": "mutation($issueId: String!, $projectId: String!) { issueUpdate(id: $issueId, input: {projectId: $projectId}) { success } }",
  "variables": {"issueId": "issue-uuid", "projectId": "project-uuid"}
}
```

**Bulk update issues:**
```json
{
  "action": "graphql",
  "graphql": "mutation($ids: [UUID!]!, $input: IssueUpdateInput!) { issueBatchUpdate(ids: $ids, input: $input) { success } }",
  "variables": {"ids": ["id1", "id2"], "input": {"priority": 2}}
}
```

## Tips

1. **IDs are flexible**: Use ABC-123, full Linear URLs, or UUIDs interchangeably
2. **States are fuzzy**: "done", "Done", "completed" all work
3. **Default search is smart**: Shows your high-priority, active issues
4. **GraphQL for admin tasks**: Project/cycle/initiative management via escape valve

## Priority Reference

| Value | Name |
|-------|------|
| 0 | No priority |
| 1 | Urgent |
| 2 | High |
| 3 | Medium |
| 4 | Low |
