import { execSync } from "child_process";
import {
  setApiToken,
  handleSearch,
  handleGet,
  handleUpdate,
  handleComment,
  handleCreate,
  handleGraphql,
  getTeams,
} from "./linear-core.js";

// CLI help text
function printHelp(): void {
  console.log(`streamlinear-cli - Linear issue management from the command line

USAGE:
  streamlinear-cli [auth options] <command> [options]

COMMANDS:
  search [query]           Search issues (default: your active issues)
  get <id>                 Get issue details
  update <id> [options]    Update an issue
  comment <id> <body>      Add a comment to an issue
  create [options]         Create a new issue
  graphql <query>          Execute raw GraphQL
  teams                    List available teams and states
  help                     Show this help

AUTHENTICATION (in order of precedence):
  --token <token>          Use this API token directly
  --token-cmd <command>    Run command to get token (stdout, trimmed)
  LINEAR*_API_TOKEN        Environment variable fallback (LINEAR_API_TOKEN, LINEAR_WORK_API_TOKEN, etc.)

SEARCH OPTIONS:
  --state <name>           Filter by state (e.g., "In Progress")
  --assignee <email|me>    Filter by assignee
  --priority <0-4>         Filter by priority (1=Urgent, 2=High, 3=Medium, 4=Low)
  --team <key>             Filter by team key

UPDATE OPTIONS:
  --state <name>           Set state
  --priority <0-4>         Set priority
  --assignee <email|me>    Set assignee (use "null" to unassign)

CREATE OPTIONS:
  --title <title>          Issue title (required)
  --team <key>             Team key (required)
  --body <description>     Issue description
  --priority <0-4>         Priority level

EXAMPLES:
  streamlinear-cli search                          # Your active issues
  streamlinear-cli search "auth bug"               # Text search
  streamlinear-cli --token abc123 search           # With explicit token
  streamlinear-cli --token-cmd "op read 'op://vault/linear/token'" search
  streamlinear-cli get ABC-123                     # Get issue details
  streamlinear-cli update ABC-123 --state Done     # Mark as done
  streamlinear-cli comment ABC-123 "Fixed it"      # Add comment
  streamlinear-cli create --team ENG --title "Bug" # Create issue
`);
}

// Parse command line arguments
function parseArgs(args: string[]): { command: string; positional: string[]; flags: Record<string, string | null> } {
  const positional: string[] = [];
  const flags: Record<string, string | null> = {};
  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = null;
      }
    } else if (!command) {
      // First non-flag argument is the command
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command: command || "help", positional, flags };
}

// Resolve API token from various sources
function resolveToken(flags: Record<string, string | null>): string | null {
  // 1. Direct token flag
  if (flags.token) {
    return flags.token;
  }

  // 2. Token command
  if (flags["token-cmd"]) {
    try {
      const result = execSync(flags["token-cmd"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error running token command: ${message}`);
      process.exit(1);
    }
  }

  // 3. Environment variable (LINEAR_API_TOKEN or any LINEAR*_API_TOKEN)
  if (process.env.LINEAR_API_TOKEN) {
    return process.env.LINEAR_API_TOKEN;
  }

  // Check for any env var ending with _API_TOKEN (e.g., LINEAR_WORK_API_TOKEN)
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith('_API_TOKEN') && key.startsWith('LINEAR') && value) {
      return value;
    }
  }

  return null;
}

// Main CLI entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, positional, flags } = parseArgs(args);

  // Help doesn't require API token
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // Resolve and set API token
  const token = resolveToken(flags);
  if (!token) {
    console.error("Error: No API token provided. Use --token, --token-cmd, or set LINEAR_API_TOKEN (or any LINEAR*_API_TOKEN)");
    process.exit(1);
  }
  setApiToken(token);

  try {
    let result: string;

    switch (command) {
      case "search": {
        if (positional.length > 0) {
          // Text search
          result = await handleSearch(positional.join(" "));
        } else if (Object.keys(flags).length > 0) {
          // Filter search
          const query: Record<string, unknown> = {};
          if (flags.state) query.state = flags.state;
          if (flags.assignee) query.assignee = flags.assignee;
          if (flags.priority) query.priority = parseInt(flags.priority, 10);
          if (flags.team) query.team = flags.team;
          result = await handleSearch(query);
        } else {
          // Default: my active issues
          result = await handleSearch();
        }
        break;
      }

      case "get": {
        const id = positional[0];
        if (!id) {
          console.error("Error: Issue ID is required");
          console.error("Usage: streamlinear-cli get <id>");
          process.exit(1);
        }
        result = await handleGet(id);
        break;
      }

      case "update": {
        const id = positional[0];
        if (!id) {
          console.error("Error: Issue ID is required");
          console.error("Usage: streamlinear-cli update <id> [--state <name>] [--priority <0-4>] [--assignee <email|me|null>]");
          process.exit(1);
        }
        const updates: { state?: string; priority?: number; assignee?: string | null } = {};
        if (flags.state) updates.state = flags.state;
        if (flags.priority) updates.priority = parseInt(flags.priority, 10);
        if (flags.assignee !== undefined) {
          updates.assignee = flags.assignee === "null" ? null : flags.assignee;
        }
        if (Object.keys(updates).length === 0) {
          console.error("Error: At least one update option is required");
          console.error("Usage: streamlinear-cli update <id> [--state <name>] [--priority <0-4>] [--assignee <email|me|null>]");
          process.exit(1);
        }
        result = await handleUpdate(id, updates);
        break;
      }

      case "comment": {
        const id = positional[0];
        const body = positional.slice(1).join(" ") || flags.body;
        if (!id || !body) {
          console.error("Error: Issue ID and comment body are required");
          console.error("Usage: streamlinear-cli comment <id> <body>");
          process.exit(1);
        }
        result = await handleComment(id, body);
        break;
      }

      case "create": {
        const title = flags.title;
        const team = flags.team;
        if (!title || !team) {
          console.error("Error: --title and --team are required");
          console.error("Usage: streamlinear-cli create --title <title> --team <key> [--body <description>] [--priority <0-4>]");
          process.exit(1);
        }
        const options: { body?: string; priority?: number } = {};
        if (flags.body) options.body = flags.body;
        if (flags.priority) options.priority = parseInt(flags.priority, 10);
        result = await handleCreate(title, team, options);
        break;
      }

      case "graphql": {
        const query = positional.join(" ");
        if (!query) {
          console.error("Error: GraphQL query is required");
          console.error("Usage: streamlinear-cli graphql <query>");
          process.exit(1);
        }
        result = await handleGraphql(query);
        break;
      }

      case "teams": {
        const teams = await getTeams();
        result = "Available teams and workflow states:\n\n";
        for (const team of teams) {
          const states = (team.states as { nodes: Array<{ name: string }> }).nodes;
          const stateNames = states.map((s) => s.name).join(", ");
          result += `${team.key} (${team.name})\n  States: ${stateNames}\n\n`;
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Run 'streamlinear-cli help' for usage");
        process.exit(1);
    }

    console.log(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
