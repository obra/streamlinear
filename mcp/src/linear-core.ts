import { z } from "zod";

const LINEAR_API = "https://api.linear.app/graphql";

// Get API token - exported for validation
export function getApiToken(): string | undefined {
  return process.env.LINEAR_API_TOKEN;
}

// GraphQL helper
export async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const token = getApiToken();
  if (!token) {
    throw new Error("LINEAR_API_TOKEN environment variable is required");
  }

  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json() as { data?: unknown; errors?: Array<{ message: string }> };

  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join("\n"));
  }

  return json.data;
}

// ID resolution: handles ABC-123, URLs, and UUIDs
export function resolveId(input: string): string {
  // Linear URL pattern
  const urlMatch = input.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  if (urlMatch) return urlMatch[1];

  // Already a short ID (ABC-123)
  if (/^[A-Z]+-\d+$/i.test(input)) return input.toUpperCase();

  // UUID - return as-is
  return input;
}

// Format issue for readable output
export function formatIssue(issue: Record<string, unknown>): string {
  const lines = [
    `**${issue.identifier}**: ${issue.title}`,
    `State: ${(issue.state as Record<string, unknown>)?.name || "Unknown"} | Priority: ${priorityName(issue.priority as number)} | Assignee: ${(issue.assignee as Record<string, unknown>)?.name || "Unassigned"}`,
  ];

  if (issue.dueDate) lines.push(`Due: ${issue.dueDate}`);
  if (issue.description) lines.push("", issue.description as string);
  if (issue.url) lines.push("", `Link: ${issue.url}`);

  return lines.join("\n");
}

export function priorityName(p: number): string {
  return ["No priority", "Urgent", "High", "Medium", "Low"][p] || "Unknown";
}

// Format issue list
export function formatIssueList(issues: Array<Record<string, unknown>>): string {
  if (issues.length === 0) return "No issues found.";

  return issues.map((issue) => {
    const state = (issue.state as Record<string, unknown>)?.name || "?";
    const priority = priorityName(issue.priority as number);
    const assignee = (issue.assignee as Record<string, unknown>)?.name || "Unassigned";
    return `- **${issue.identifier}** [${state}] ${issue.title} (${priority}, ${assignee})`;
  }).join("\n");
}

// Cache for workflow states and team info
let cachedViewer: Record<string, unknown> | null = null;
let cachedTeams: Array<Record<string, unknown>> | null = null;

export async function getViewer(): Promise<Record<string, unknown>> {
  if (cachedViewer) return cachedViewer;

  const data = await graphql(`query { viewer { id name email } }`) as { viewer: Record<string, unknown> };
  cachedViewer = data.viewer;
  return cachedViewer;
}

export async function getTeams(): Promise<Array<Record<string, unknown>>> {
  if (cachedTeams) return cachedTeams;

  const data = await graphql(`
    query {
      teams {
        nodes {
          id
          key
          name
          states { nodes { id name type } }
        }
      }
    }
  `) as { teams: { nodes: Array<Record<string, unknown>> } };

  cachedTeams = data.teams.nodes;
  return cachedTeams;
}

// Fuzzy match state name
export async function resolveState(teamId: string, stateName: string): Promise<string | null> {
  const teams = await getTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) return null;

  const states = (team.states as { nodes: Array<Record<string, unknown>> }).nodes;
  const lower = stateName.toLowerCase();

  // Exact match first
  let match = states.find((s) => (s.name as string).toLowerCase() === lower);
  if (match) return match.id as string;

  // Partial match
  match = states.find((s) => (s.name as string).toLowerCase().includes(lower));
  if (match) return match.id as string;

  // Common aliases
  const aliases: Record<string, string[]> = {
    "done": ["done", "complete", "completed", "finished"],
    "in progress": ["in progress", "started", "doing", "wip", "in prog"],
    "todo": ["todo", "to do", "backlog", "open"],
    "canceled": ["canceled", "cancelled", "closed", "wontfix"],
  };

  for (const [canonical, alts] of Object.entries(aliases)) {
    if (alts.includes(lower)) {
      match = states.find((s) => (s.name as string).toLowerCase().includes(canonical));
      if (match) return match.id as string;
    }
  }

  return null;
}

// Resolve team by key or name
export async function resolveTeam(input: string): Promise<Record<string, unknown> | null> {
  const teams = await getTeams();
  const lower = input.toLowerCase();

  return teams.find((t) =>
    (t.key as string).toLowerCase() === lower ||
    (t.name as string).toLowerCase() === lower
  ) || null;
}

// Action handlers
export async function handleSearch(query?: string | Record<string, unknown>): Promise<string> {
  const viewer = await getViewer();

  let filter = "";

  if (!query) {
    // Default: my issues, not completed, high priority
    filter = `filter: { assignee: { id: { eq: "${viewer.id}" } }, state: { type: { nin: ["completed", "canceled"] } } }`;
  } else if (typeof query === "string") {
    // Text search
    const data = await graphql(`
      query($term: String!) {
        searchIssues(term: $term, first: 20) {
          nodes {
            id identifier title state { name } priority assignee { name } dueDate
          }
        }
      }
    `, { term: query }) as { searchIssues: { nodes: Array<Record<string, unknown>> } };

    return formatIssueList(data.searchIssues.nodes);
  } else {
    // Build filter from object
    const filters: string[] = [];

    if (query.assignee === "me") {
      filters.push(`assignee: { id: { eq: "${viewer.id}" } }`);
    } else if (query.assignee) {
      filters.push(`assignee: { email: { eq: "${query.assignee}" } }`);
    }

    if (query.state) {
      filters.push(`state: { name: { eqIgnoreCase: "${query.state}" } }`);
    }

    if (query.priority !== undefined) {
      filters.push(`priority: { eq: ${query.priority} }`);
    }

    if (query.team) {
      const team = await resolveTeam(query.team as string);
      if (team) filters.push(`team: { id: { eq: "${team.id}" } }`);
    }

    if (filters.length > 0) {
      filter = `filter: { ${filters.join(", ")} }`;
    }
  }

  const data = await graphql(`
    query {
      issues(${filter}, first: 20, orderBy: updatedAt) {
        nodes {
          id identifier title state { name } priority assignee { name } dueDate
        }
      }
    }
  `) as { issues: { nodes: Array<Record<string, unknown>> } };

  return formatIssueList(data.issues.nodes);
}

export async function handleGet(id: string): Promise<string> {
  const resolved = resolveId(id);

  const data = await graphql(`
    query($id: String!) {
      issue(id: $id) {
        id identifier title description state { name } priority
        assignee { name email }
        labels { nodes { name } }
        dueDate estimate url
        team { id key name }
        comments(first: 5) {
          nodes { body createdAt user { name } }
        }
      }
    }
  `, { id: resolved }) as { issue: Record<string, unknown> | null };

  if (!data.issue) {
    return `Issue ${id} not found`;
  }

  const issue = data.issue;
  const labels = ((issue.labels as { nodes: Array<{ name: string }> })?.nodes || [])
    .map((l) => l.name).join(", ");

  let result = formatIssue(issue);

  if (labels) result += `\nLabels: ${labels}`;

  const comments = (issue.comments as { nodes: Array<Record<string, unknown>> })?.nodes || [];
  if (comments.length > 0) {
    result += "\n\n## Recent Comments\n";
    result += comments.map((c) =>
      `**${(c.user as Record<string, unknown>)?.name}** (${c.createdAt}):\n${c.body}`
    ).join("\n\n");
  }

  return result;
}

export async function handleUpdate(
  id: string,
  updates: { state?: string; priority?: number; assignee?: string | null; labels?: string[] }
): Promise<string> {
  const resolved = resolveId(id);

  // First get the issue to find its team
  const issueData = await graphql(`
    query($id: String!) {
      issue(id: $id) { id team { id } }
    }
  `, { id: resolved }) as { issue: { id: string; team: { id: string } } | null };

  if (!issueData.issue) {
    return `Issue ${id} not found`;
  }

  const input: Record<string, unknown> = {};

  if (updates.state) {
    const stateId = await resolveState(issueData.issue.team.id, updates.state);
    if (stateId) {
      input.stateId = stateId;
    } else {
      // Get valid states for this team
      const teams = await getTeams();
      const team = teams.find((t) => t.id === issueData.issue.team.id);
      const validStates = team
        ? (team.states as { nodes: Array<Record<string, unknown>> }).nodes
            .map((s) => s.name as string)
            .join(", ")
        : "unknown";
      return `State "${updates.state}" not found. Valid states: ${validStates}`;
    }
  }

  if (updates.priority !== undefined) {
    input.priority = updates.priority;
  }

  if (updates.assignee !== undefined) {
    if (updates.assignee === null) {
      input.assigneeId = null;
    } else if (updates.assignee === "me") {
      const viewer = await getViewer();
      input.assigneeId = viewer.id;
    } else {
      // Look up by email
      const userData = await graphql(`
        query { users { nodes { id email } } }
      `) as { users: { nodes: Array<{ id: string; email: string }> } };

      const user = userData.users.nodes.find((u) =>
        u.email.toLowerCase() === updates.assignee!.toLowerCase()
      );
      if (user) {
        input.assigneeId = user.id;
      } else {
        return `Could not find user with email "${updates.assignee}"`;
      }
    }
  }

  if (Object.keys(input).length === 0) {
    return "No updates provided";
  }

  const updateResult = await graphql(`
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { identifier title state { name } priority assignee { name } }
      }
    }
  `, { id: issueData.issue.id, input }) as { issueUpdate: { issue: Record<string, unknown> } };

  const issue = updateResult.issueUpdate.issue;
  const changes: string[] = [];
  if (updates.state) changes.push(`state → ${(issue.state as Record<string, unknown>)?.name}`);
  if (updates.priority !== undefined) changes.push(`priority → ${priorityName(issue.priority as number)}`);
  if (updates.assignee !== undefined) {
    changes.push(`assignee → ${(issue.assignee as Record<string, unknown>)?.name || "Unassigned"}`);
  }

  return `Updated ${issue.identifier}: ${changes.join(", ")}`;
}

export async function handleComment(id: string, body: string): Promise<string> {
  const resolved = resolveId(id);

  // Get issue ID
  const issueData = await graphql(`
    query($id: String!) {
      issue(id: $id) { id identifier }
    }
  `, { id: resolved }) as { issue: { id: string; identifier: string } | null };

  if (!issueData.issue) {
    return `Issue ${id} not found`;
  }

  await graphql(`
    mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }
  `, { issueId: issueData.issue.id, body });

  const truncated = body.length > 100 ? body.slice(0, 100) + "..." : body;
  return `Added comment to ${issueData.issue.identifier}:\n> ${truncated}`;
}

export async function handleCreate(
  title: string,
  team: string,
  options: { body?: string; priority?: number; labels?: string[] }
): Promise<string> {
  const teamData = await resolveTeam(team);
  if (!teamData) {
    const teams = await getTeams();
    const validTeams = teams.map((t) => `${t.key} (${t.name})`).join(", ");
    return `Team "${team}" not found. Available: ${validTeams}`;
  }

  const input: Record<string, unknown> = {
    title,
    teamId: teamData.id,
  };

  if (options.body) input.description = options.body;
  if (options.priority !== undefined) input.priority = options.priority;

  const data = await graphql(`
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { identifier title url }
      }
    }
  `, { input }) as { issueCreate: { success: boolean; issue: { identifier: string; title: string; url: string } } };

  const issue = data.issueCreate.issue;
  return `Created ${issue.identifier}: ${issue.title}\n${issue.url}`;
}

export async function handleGraphql(query: string, variables?: Record<string, unknown>): Promise<string> {
  const data = await graphql(query, variables || {});
  return JSON.stringify(data, null, 2);
}

export function handleHelp(): string {
  return `# Linear MCP

## Actions

**search** - Find issues
  {"action": "search"}                           → your active issues
  {"action": "search", "query": "auth bug"}      → text search
  {"action": "search", "query": {"state": "In Progress", "assignee": "me"}}

**get** - Issue details (accepts ABC-123, URLs, or UUIDs)
  {"action": "get", "id": "ABC-123"}

**update** - Change state, priority, assignee
  {"action": "update", "id": "ABC-123", "state": "Done"}
  {"action": "update", "id": "ABC-123", "priority": 1}
  {"action": "update", "id": "ABC-123", "assignee": "me"}
  {"action": "update", "id": "ABC-123", "assignee": null}  → unassign

**comment** - Add comment to issue
  {"action": "comment", "id": "ABC-123", "body": "Fixed in abc123"}

**create** - Create new issue
  {"action": "create", "title": "Bug title", "team": "ENG"}
  {"action": "create", "title": "Bug", "team": "ENG", "body": "Details", "priority": 2}

**graphql** - Raw GraphQL for anything else
  {"action": "graphql", "graphql": "query { projects { nodes { id name } } }"}

## Reference

Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low

Query filters: {assignee: "me"|email, state: "name", priority: 0-4, team: "KEY"}

Search default: your issues, excluding completed/canceled

State matching is fuzzy: "done" → "Done", "in prog" → "In Progress"

IDs accept: ABC-123, linear.app URLs, or UUIDs`;
}

// Tool parameter schema
export const LinearParams = z.object({
  action: z.enum(["search", "get", "update", "comment", "create", "graphql", "help"]),
  query: z.union([z.string(), z.record(z.unknown())]).optional(),
  id: z.string().optional(),
  state: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  body: z.string().optional(),
  title: z.string().optional(),
  team: z.string().optional(),
  graphql: z.string().optional(),
  variables: z.record(z.unknown()).optional(),
});

export type LinearParamsType = z.infer<typeof LinearParams>;

// Build dynamic tool description with teams/states
export async function buildToolDescription(): Promise<string> {
  const teams = await getTeams();

  const teamLines = teams.map((team) => {
    const states = (team.states as { nodes: Array<Record<string, unknown>> }).nodes;
    const stateNames = states.map((s) => {
      const name = s.name as string;
      return name.includes(",") ? `"${name}"` : name;
    }).join(", ");
    return `  ${team.key}: ${stateNames}`;
  });

  return `Linear issues. Actions: help, search, get, update, comment, create, graphql

Teams (workflow states):
${teamLines.join("\n")}

{"action": "search"} → your active issues
{"action": "search", "query": "text"} → text search
{"action": "get", "id": "ABC-123"} → issue details
{"action": "update", "id": "ABC-123", "state": "Done"}
{"action": "create", "title": "Title", "team": "${teams[0]?.key || 'KEY'}"}
{"action": "help"} → full documentation`;
}

// Dispatch action based on params
export async function dispatchAction(params: LinearParamsType): Promise<string> {
  switch (params.action) {
    case "search":
      return await handleSearch(params.query);

    case "get":
      if (!params.id) throw new Error("id is required for get action");
      return await handleGet(params.id);

    case "update":
      if (!params.id) throw new Error("id is required for update action");
      return await handleUpdate(params.id, {
        state: params.state,
        priority: params.priority,
        assignee: params.assignee,
        labels: params.labels,
      });

    case "comment":
      if (!params.id) throw new Error("id is required for comment action");
      if (!params.body) throw new Error("body is required for comment action");
      return await handleComment(params.id, params.body);

    case "create":
      if (!params.title) throw new Error("title is required for create action");
      if (!params.team) throw new Error("team is required for create action");
      return await handleCreate(params.title, params.team, {
        body: params.body,
        priority: params.priority,
        labels: params.labels,
      });

    case "graphql":
      if (!params.graphql) throw new Error("graphql query is required for graphql action");
      return await handleGraphql(params.graphql, params.variables);

    case "help":
      return handleHelp();

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}
