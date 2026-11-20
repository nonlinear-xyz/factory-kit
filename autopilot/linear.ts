import { exec } from "./exec.js";
import type { Ticket } from "./types.js";

/** Keychain item the runner reads when LINEAR_API_KEY isn't in the environment (macOS). */
export const KEYCHAIN_SERVICE = "factory-kit-linear";

/** Env first, then the macOS Keychain, so the key never has to be exported in every shell. */
export function linearToken(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.LINEAR_API_KEY) return env.LINEAR_API_KEY;
  if (process.platform !== "darwin") return null;
  const r = exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

const ENDPOINT = "https://api.linear.app/graphql";

type Fetch = typeof fetch;

export class Linear {
  constructor(private readonly token: string, private readonly fetchImpl: Fetch = fetch) {}

  static fromEnv(): Linear {
    const token = linearToken();
    if (!token) throw new Error(`No Linear key. Store one with: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w   (or set LINEAR_API_KEY)`);
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
        team { states { nodes { id name type } } }
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

  /** Mark `ticket` a duplicate of `canonicalId`, then move it to the team's Duplicate (or first canceled) state. */
  async markDuplicate(ticket: Ticket, canonicalId: string): Promise<void> {
    await this.query(`mutation R($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`, { input: { issueId: ticket.id, relatedIssueId: canonicalId, type: "duplicate" } });
    const state = ticket.teamStates.find((s) => /duplicate/i.test(s.name)) ?? ticket.teamStates.find((s) => s.type === "canceled");
    if (state) await this.query(`mutation U($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id: ticket.id, input: { stateId: state.id } });
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
  team: { states: { nodes: { id: string; name: string; type: string }[] } };
}
