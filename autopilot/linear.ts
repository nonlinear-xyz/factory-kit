import type { Ticket } from "./types.js";

const ENDPOINT = "https://api.linear.app/graphql";

type Fetch = typeof fetch;

export class Linear {
  constructor(private readonly token: string, private readonly fetchImpl: Fetch = fetch) {}

  static fromEnv(): Linear {
    const token = process.env.LINEAR_API_KEY;
    if (!token) throw new Error("LINEAR_API_KEY is not set. Create a personal API key in Linear → Settings → Security & access.");
    return new Linear(token);
  }

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: this.token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (!res.ok || body.errors?.length || !body.data) {
      throw new Error(`Linear: ${body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
    }
    return body.data;
  }

  async ticket(identifier: string): Promise<Ticket> {
    const data = await this.query<{ issue: RawIssue | null }>(
      `query Ticket($id: String!) { issue(id: $id) {
        id identifier title url branchName
        state { name }
        labels { nodes { name } }
        team { states { nodes { id name } } }
      } }`,
      { id: identifier },
    );
    const i = data.issue;
    if (!i || i.identifier.toUpperCase() !== identifier.toUpperCase()) throw new Error(`Linear did not resolve ${identifier}.`);
    return {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: i.url,
      branchName: i.branchName,
      stateName: i.state.name,
      labels: i.labels.nodes.map((l) => l.name),
      teamStates: i.team.states.nodes,
    };
  }

  async comment(issueId: string, body: string): Promise<void> {
    await this.query(`mutation C($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, { input: { issueId, body } });
  }

  async moveTo(ticket: Ticket, stateName: string): Promise<void> {
    const state = ticket.teamStates.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
    if (!state) throw new Error(`Team has no state named "${stateName}".`);
    await this.query(`mutation U($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id: ticket.id, input: { stateId: state.id } });
  }
}

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
  state: { name: string };
  labels: { nodes: { name: string }[] };
  team: { states: { nodes: { id: string; name: string }[] } };
}
