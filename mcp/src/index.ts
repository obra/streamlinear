import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getApiToken,
  buildToolDescription,
  dispatchAction,
  LinearParams,
} from "./linear-core.js";

// Check for API token
if (!getApiToken()) {
  console.error("Linear API token required (set LINEAR_API_TOKEN or any LINEAR*_API_TOKEN environment variable)");
  process.exit(1);
}

// Create MCP server
const server = new McpServer({
  name: "linear",
  version: "1.0.0",
});

// Fetch teams/states at startup, then register tool
const toolDescription = await buildToolDescription();

// Register single tool
server.tool(
  "linear",
  toolDescription,
  LinearParams.shape,
  async (args) => {
    const params = LinearParams.parse(args);

    try {
      const result = await dispatchAction(params);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }] };
    }
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
