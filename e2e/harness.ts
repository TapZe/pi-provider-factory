/**
 * E2E harness for driving the Oh My Pi CLI as a subprocess against an
 * isolated profile. Used only by e2e/cli.e2e.ts (invoked via `bun run
 * test:e2e`); nothing here runs during plain `bun test`.
 *
 * Design rules:
 * - The isolated profile is provisioned by the CLI itself (plugin link, DB
 *   schema creation). Only the active Factory OAuth credential row is copied
 *   from the source auth DB — never whole databases, and credential JSON is
 *   handled as an opaque string that is never printed.
 * - Source auth discovery: OMP_E2E_SOURCE_AUTH_DB (explicit path) >
 *   OMP_E2E_SOURCE_PROFILE (named profile) > the default profile's agent.db.
 *   OMP_HOME relocates the whole omp data dir.
 * - Live tiers are gated: OMP_E2E_OAUTH=1 (OAuth /usage), OMP_E2E_API_KEY
 *   (Factory fk-... key), OMP_E2E_MODEL_CALL=1 (real model spend).
 */
import { Database } from "bun:sqlite";
import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const PROVIDER_ROOT = path.resolve(import.meta.dir, "..");
export const OMP_HOME = process.env.OMP_HOME ?? path.join(os.homedir(), ".omp");

const CLI_WORDS = (process.env.OMP_E2E_CLI ?? "omp").split(" ").filter(word => word.length > 0);

export const GATES = {
	oauth: process.env.OMP_E2E_OAUTH === "1",
	apiKey: process.env.OMP_E2E_API_KEY?.trim() || undefined,
	modelCall: process.env.OMP_E2E_MODEL_CALL === "1",
	keep: process.env.OMP_E2E_KEEP === "1",
	sourceProfile: process.env.OMP_E2E_SOURCE_PROFILE?.trim() || undefined,
	sourceAuthDb: process.env.OMP_E2E_SOURCE_AUTH_DB?.trim() || undefined,
};

export interface CliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** Env with unrelated provider credentials scrubbed so probes stay hermetic. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (key.endsWith("_API_KEY") || key.endsWith("_TOKEN") || key.startsWith("FACTORY_")) continue;
		env[key] = value;
	}
	return { ...env, ...extra };
}

export function runCli(
	args: string[],
	options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CliResult> {
	const [cmd, ...prefix] = CLI_WORDS;
	const { promise, resolve, reject } = Promise.withResolvers<CliResult>();
	const child = spawn(cmd, [...prefix, ...args], {
		env: options.env ?? cleanEnv(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		reject(new Error(`omp ${args.join(" ")} timed out after ${options.timeoutMs ?? 120_000}ms`));
	}, options.timeoutMs ?? 120_000);
	child.stdout.on("data", chunk => {
		stdout += chunk;
	});
	child.stderr.on("data", chunk => {
		stderr += chunk;
	});
	child.on("error", error => {
		clearTimeout(timer);
		reject(error);
	});
	child.on("close", exitCode => {
		clearTimeout(timer);
		resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
	});
	return promise;
}

let cachedCliVersion: string | null | undefined;

/** CLI version string, or null when the configured CLI is unavailable. */
export async function cliVersion(): Promise<string | null> {
	if (cachedCliVersion !== undefined) return cachedCliVersion;
	try {
		const result = await runCli(["--version"], { timeoutMs: 30_000 });
		cachedCliVersion = result.exitCode === 0 ? (result.stdout.trim().split("\n")[0] ?? null) : null;
	} catch {
		cachedCliVersion = null;
	}
	return cachedCliVersion;
}

export function profileDir(profile: string): string {
	return path.join(OMP_HOME, "profiles", profile);
}

function profileAgentDb(profile: string): string {
	return path.join(profileDir(profile), "agent", "agent.db");
}

function sourceAuthDbPath(): string {
	if (GATES.sourceAuthDb) return GATES.sourceAuthDb;
	if (GATES.sourceProfile) return profileAgentDb(GATES.sourceProfile);
	return path.join(OMP_HOME, "agent", "agent.db");
}

/**
 * Provision an isolated profile with the provider extension linked and the
 * CLI-managed schemas initialized. `usage` creates agent.db; `models find`
 * creates models.db and hydrates the Factory catalog into the profile cache.
 */
export async function provisionProfile(profile: string, extraEnv: Record<string, string> = {}): Promise<void> {
	const env = cleanEnv(extraEnv);
	const link = await runCli(["--profile", profile, "plugin", "link", PROVIDER_ROOT], { env });
	if (link.exitCode !== 0) {
		throw new Error(`plugin link failed for profile ${profile}: ${link.stderr.trim() || link.stdout.trim()}`);
	}
	// `omp usage` exits 1 on a credential-less profile ("No credentials found")
	// but still creates agent.db — the actual requirement for seeding.
	const usage = await runCli(["--profile", profile, "usage"], { env });
	if (!fs.existsSync(profileAgentDb(profile))) {
		throw new Error(
			`usage init failed for profile ${profile}: agent.db was not created: ${usage.stderr.trim() || usage.stdout.trim()}`,
		);
	}
	const models = await runCli(["--profile", profile, "models", "find", "factory"], { env, timeoutMs: 180_000 });
	if (models.exitCode !== 0) {
		throw new Error(`models find factory failed for profile ${profile}: ${models.stderr.trim()}`);
	}
}

export function removeProfile(profile: string): void {
	if (GATES.keep) return;
	fs.rmSync(profileDir(profile), { recursive: true, force: true });
}

interface StoredCredentialRow {
	provider: string;
	credential_type: string;
	data: string;
	disabled_cause: string | null;
	identity_key: string | null;
	created_at: number;
	updated_at: number;
}

/**
 * Copy the active Factory OAuth credential row into the isolated profile.
 * Source DB is opened readonly; the credential payload stays an opaque
 * string end to end. Returns the number of rows copied.
 */
export function seedFactoryOAuth(profile: string): number {
	const sourcePath = sourceAuthDbPath();
	if (!fs.existsSync(sourcePath)) return 0;
	const source = new Database(sourcePath, { readonly: true });
	let rows: StoredCredentialRow[];
	try {
		rows = source
			.query(
				`SELECT provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at
				 FROM auth_credentials
				 WHERE provider = 'factory' AND credential_type = 'oauth' AND disabled_cause IS NULL`,
			)
			.all() as StoredCredentialRow[];
	} finally {
		source.close();
	}
	if (rows.length === 0) return 0;

	const target = new Database(profileAgentDb(profile));
	try {
		const insert = target.prepare(
			`INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const row of rows) {
			insert.run(
				row.provider,
				row.credential_type,
				row.data,
				row.disabled_cause,
				row.identity_key,
				row.created_at,
				row.updated_at,
			);
		}
		return rows.length;
	} finally {
		target.close();
	}
}

/** Access token of the seeded Factory OAuth row, for log-hygiene assertions only. */
export function seededFactoryAccessToken(profile: string): string | null {
	const db = new Database(profileAgentDb(profile), { readonly: true });
	try {
		const row = db
			.query(
				`SELECT data FROM auth_credentials
				 WHERE provider = 'factory' AND credential_type = 'oauth' AND disabled_cause IS NULL
				 LIMIT 1`,
			)
			.get() as { data: string } | null;
		if (!row) return null;
		const parsed = JSON.parse(row.data) as { access?: unknown };
		return typeof parsed.access === "string" && parsed.access.length > 0 ? parsed.access : null;
	} finally {
		db.close();
	}
}

export function profileUsageCacheRows(profile: string): number {
	const db = new Database(profileAgentDb(profile), { readonly: true });
	try {
		const row = db
			.query(`SELECT COUNT(*) AS n FROM cache WHERE key LIKE 'usage_cache:report:factory:%'`)
			.get() as { n: number };
		return row.n;
	} finally {
		db.close();
	}
}

export function profileFactoryHistoryRows(profile: string): number {
	const db = new Database(profileAgentDb(profile), { readonly: true });
	try {
		const row = db.query(`SELECT COUNT(*) AS n FROM usage_history WHERE provider = 'factory'`).get() as {
			n: number;
		};
		return row.n;
	} finally {
		db.close();
	}
}

/** Profile log files content joined; used only with already-safe needles. */
export function profileLogsContain(profile: string, needle: string): boolean {
	const logsDir = path.join(profileDir(profile), "logs");
	if (!fs.existsSync(logsDir)) return false;
	for (const file of fs.readdirSync(logsDir)) {
		if (!file.endsWith(".log")) continue;
		if (fs.readFileSync(path.join(logsDir, file), "utf8").includes(needle)) return true;
	}
	return false;
}

interface JsonRpcMessage {
	jsonrpc: string;
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

/**
 * Minimal ACP stdio client (ndJSON JSON-RPC). Agent-to-client requests are
 * auto-declined with "method not found": every client capability advertised
 * at initialize is false, so these are not expected, but a reply keeps the
 * agent from hanging if one arrives anyway.
 */
export class AcpClient {
	#child: ChildProcess;
	#nextId = 1;
	#pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	#buffer = "";
	#chunkText = new Map<string, string[]>();
	#closed = false;

	private constructor(child: ChildProcess) {
		this.#child = child;
		let stderr = "";
		child.stderr?.on("data", chunk => {
			stderr += chunk;
			// ACP runs the agent on stdout; stderr is diagnostic only.
			if (stderr.length > 4096) stderr = stderr.slice(-4096);
			this.lastStderr = stderr;
		});
		child.stdout?.on("data", chunk => {
			this.#buffer += chunk;
			let newline = this.#buffer.indexOf("\n");
			while (newline !== -1) {
				const line = this.#buffer.slice(0, newline).trim();
				this.#buffer = this.#buffer.slice(newline + 1);
				if (line.length > 0) this.#handleLine(line);
				newline = this.#buffer.indexOf("\n");
			}
		});
		child.on("close", () => {
			this.#closed = true;
			for (const { reject } of this.#pending.values()) {
				reject(new Error(`ACP process exited${this.lastStderr ? `: ${this.lastStderr.trim().slice(-300)}` : ""}`));
			}
			this.#pending.clear();
		});
	}

	lastStderr = "";

	static async start(profile: string, cwd: string, env: Record<string, string>): Promise<AcpClient> {
		const [cmd, ...prefix] = CLI_WORDS;
		const child = spawn(cmd, [...prefix, "--profile", profile, "--cwd", cwd, "acp"], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const client = new AcpClient(child);
		await client.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
		});
		return client;
	}

	#handleLine(line: string): void {
		let message: JsonRpcMessage;
		try {
			message = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return;
		}
		if (message.method === "session/update") {
			const params = message.params as
				| { sessionId?: string; update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }
				| undefined;
			const update = params?.update;
			if (params?.sessionId && update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
				const chunks = this.#chunkText.get(params.sessionId) ?? [];
				chunks.push(update.content.text);
				this.#chunkText.set(params.sessionId, chunks);
			}
			return;
		}
		if (message.id !== undefined && message.method !== undefined) {
			// Agent-initiated request: decline so the agent never blocks on us.
			this.#send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
			return;
		}
		if (message.id !== undefined) {
			const pending = this.#pending.get(Number(message.id));
			if (!pending) return;
			this.#pending.delete(Number(message.id));
			if (message.error) {
				pending.reject(new Error(`ACP error ${message.error.code}: ${message.error.message}`));
			} else {
				pending.resolve(message.result);
			}
		}
	}

	#send(message: JsonRpcMessage): void {
		if (this.#closed) throw new Error("ACP client is closed");
		this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
		const id = this.#nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.#pending.delete(id);
			reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		this.#pending.set(id, {
			resolve: value => {
				clearTimeout(timer);
				resolve(value);
			},
			reject: error => {
				clearTimeout(timer);
				reject(error);
			},
		});
		this.#send({ jsonrpc: "2.0", id, method, params });
		return promise;
	}

	async newSession(cwd: string): Promise<string> {
		const result = (await this.request("session/new", { cwd, mcpServers: [] })) as { sessionId: string };
		return result.sessionId;
	}

	/** Set the session model, e.g. "factory/kimi-k2.5". Rejects when the model is unknown to the agent. */
	async setModel(sessionId: string, modelId: string): Promise<void> {
		await this.request("session/set_config_option", { sessionId, configId: "model", value: modelId });
	}

	/** Send a prompt and return the concatenated agent text plus stop reason. */
	async prompt(sessionId: string, text: string, timeoutMs = 180_000): Promise<{ text: string; stopReason: string }> {
		this.#chunkText.delete(sessionId);
		const result = (await this.request(
			"session/prompt",
			{ sessionId, prompt: [{ type: "text", text }] },
			timeoutMs,
		)) as { stopReason?: string };
		const combined = (this.#chunkText.get(sessionId) ?? []).join("");
		this.#chunkText.delete(sessionId);
		return { text: combined, stopReason: result.stopReason ?? "unknown" };
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#child.stdin?.end();
		this.#child.kill("SIGTERM");
		await new Promise(resolve => setTimeout(resolve, 300));
		if (this.#child.exitCode === null) this.#child.kill("SIGKILL");
	}
}

export function makeWorkspace(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-provider-factory-e2e-"));
}
