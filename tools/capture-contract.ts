#!/usr/bin/env bun
/**
 * capture-contract — capture Droid's LLM gateway request contract for the
 * installed Droid version and snapshot it for drift detection.
 *
 * Usage:
 *   bun tools/capture-contract.ts                 # capture + snapshot + auto-diff vs previous
 *   bun tools/capture-contract.ts --verify-live   # additionally re-run the attestation
 *                                                 # bisect against the real gateway (paid calls,
 *                                                 # uses the local omp Factory OAuth token)
 *   bun tools/capture-contract.ts --diff <a> <b>  # diff two snapshot files (paths or versions)
 *
 * Safety contract (do not weaken):
 * - Loopback capture only; bearer tokens are never persisted — credential
 *   headers are redacted in-process before anything is written.
 * - Droid's proprietary system prompt is NOT committed. Snapshots record
 *   metadata only (presence, length, sha256, first line). The raw prompt is
 *   written to .contract/ (gitignored) solely so a maintainer making an
 *   explicit, knowingly-unsupported stopgap decision can find it locally.
 * - Live verification forwards Droid's exact body at most once per
 *   route+body hash (dedup) to bound paid gateway traffic.
 */
import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const SNAPSHOT_DIR = path.join(REPO_ROOT, "contract");
const PROMPT_DIR = path.join(REPO_ROOT, ".contract");
const OMP_HOME = process.env.OMP_HOME ?? path.join(os.homedir(), ".omp");

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|.*token.*)$/i;
const SKIP_HEADER = /^(host|content-length|content-type|connection|accept-encoding)$/i;
// Headers never written to snapshots: transport noise or per-run values.
const SNAPSHOT_SKIP_HEADER = /^(host|content-length|connection|accept-encoding)$/i;
const VOLATILE_HEADER = /^(x-session-id|x-assistant-message-id|traceparent)$/i;
// Machine-derived SDK telemetry (arch/os/runtime build): presence is
// contract-relevant, values are not — they would fabricate cross-machine drift.
// x-stainless-package-version stays raw: it tracks the SDK contract itself.
const ENV_HEADER = /^x-stainless-(arch|os|runtime-version)$/i;
const VOLATILE_BODY_KEYS = new Set(["prompt_cache_key", "safety_identifier"]);

/**
 * Body keys that carry the proprietary system prompt. Snapshots record
 * metadata via SystemChannelInfo only — never the content.
 */
const SYSTEM_CHANNEL_KEYS: Record<RouteProbe["route"], string> = {
	chat: "", // chat carries it inside messages[]; shaped to roles/types only
	messages: "system",
	responses: "instructions",
};

interface RouteProbe {
	route: "chat" | "messages" | "responses";
	model: string;
	pathFragment: string;
	realUrl: string;
}

const ROUTE_MATRIX: RouteProbe[] = [
	{ route: "chat", model: "kimi-k2.6", pathFragment: "chat/completions", realUrl: "https://api.factory.ai/api/llm/o/v1/chat/completions" },
	{ route: "messages", model: "claude-haiku-4-5-20251001", pathFragment: "/api/llm/a/v1/messages", realUrl: "https://api.factory.ai/api/llm/a/v1/messages" },
	{ route: "responses", model: "gpt-5.4-mini", pathFragment: "/api/llm/o/v1/responses", realUrl: "https://api.factory.ai/api/llm/o/v1/responses" },
];

const CANNED_SSE: Record<RouteProbe["route"], string> = {
	chat: 'data: {"id":"x","object":"chat.completion.chunk","created":0,"model":"echo","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
	messages:
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_x","type":"message","role":"assistant","model":"echo","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
	responses:
		'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r_x","object":"response","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
};

interface SystemChannelInfo {
	field: string;
	present: boolean;
	length?: number;
	sha256?: string;
	blockCount?: number;
}

interface RouteCapture {
	method: string;
	path: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
	toolsCount?: number;
	systemChannel: SystemChannelInfo;
}

interface VerifyResult {
	verbatimOmpToken: string;
	systemStripped: string;
	genericContent: string;
}

/**
 * Point-in-time live attestation result, written only by --verify-live as a
 * SEPARATE artifact. Kept out of the contract snapshot so plain captures are
 * mode-stable and contract diffs never see verification state.
 */
interface VerifySnapshot {
	schemaVersion: 1;
	capturedAt: string;
	droidVersion: string;
	routes: Partial<Record<RouteProbe["route"], VerifyResult>>;
}

interface Snapshot {
	schemaVersion: 1;
	capturedAt: string;
	droidVersion: string;
	routes: Partial<Record<RouteProbe["route"], RouteCapture>>;
}

function sha256(text: string): string {
	return crypto.createHash("sha256").update(text).digest("hex");
}

function shapeMessage(message: unknown): unknown {
	if (typeof message !== "object" || message === null) return typeof message;
	const role = "role" in message ? message.role : undefined;
	const content = "content" in message ? message.content : undefined;
	return {
		role,
		contentType: Array.isArray(content)
			? content.map(part => (typeof part === "object" && part !== null && "type" in part ? part.type : "?"))
			: typeof content,
	};
}

function shapeBodyValue(key: string, value: unknown): unknown {
	if (VOLATILE_BODY_KEYS.has(key)) return "<dynamic>";
	if (key === "messages" || key === "input") return Array.isArray(value) ? value.map(shapeMessage) : typeof value;
	if (key === "tools" || key === "functions") return Array.isArray(value) ? `array(${value.length})` : typeof value;
	if (typeof value === "object" && value !== null) {
		return `<${Array.isArray(value) ? `array(${value.length})` : "object"} keys=${Object.keys(value).join("|")}>`;
	}
	return value;
}

function extractSystemChannel(
	route: RouteProbe["route"],
	body: Record<string, unknown>,
	promptSink: (route: RouteProbe["route"], text: string) => void,
): SystemChannelInfo {
	if (route === "chat" && Array.isArray(body.messages)) {
		const system = body.messages.find(
			m => typeof m === "object" && m !== null && "role" in m && m.role === "system",
		) as { content?: unknown } | undefined;
		const text = typeof system?.content === "string" ? system.content : undefined;
		if (text !== undefined) {
			promptSink(route, text);
			return {
				field: "messages[role=system]",
				present: true,
				length: text.length,
				sha256: sha256(text),
			};
		}
		return { field: "messages[role=system]", present: false };
	}
	if (route === "messages" && body.system !== undefined) {
		const blocks = Array.isArray(body.system) ? body.system : [body.system];
		const text = blocks
			.map(block =>
				typeof block === "string" ? block : typeof block === "object" && block !== null && "text" in block ? String(block.text) : "",
			)
			.join("\n");
		promptSink(route, text);
		return {
			field: "system",
			present: true,
			length: text.length,
			sha256: sha256(text),
			blockCount: blocks.length,
		};
	}
	if (route === "responses" && typeof body.instructions === "string") {
		promptSink(route, body.instructions);
		return {
			field: "instructions",
			present: true,
			length: body.instructions.length,
			sha256: sha256(body.instructions),
		};
	}
	const field = route === "messages" ? "system" : route === "responses" ? "instructions" : "messages[role=system]";
	return { field, present: false };
}

function stripSystemChannel(route: RouteProbe["route"], body: Record<string, unknown>): string {
	const copy = { ...body };
	if (route === "messages") delete copy.system;
	else if (route === "responses") delete copy.instructions;
	else if (Array.isArray(copy.messages)) {
		copy.messages = copy.messages.filter(
			m => typeof m === "object" && m !== null && "role" in m && m.role !== "system",
		);
	}
	return JSON.stringify(copy);
}

function genericSystemChannel(route: RouteProbe["route"], body: Record<string, unknown>): string {
	if (route === "messages") return JSON.stringify({ ...body, system: [{ type: "text", text: "You are a helpful assistant." }] });
	if (route === "responses") return JSON.stringify({ ...body, instructions: "You are a helpful assistant." });
	const copy = { ...body };
	if (Array.isArray(copy.messages)) {
		copy.messages = copy.messages.map(m =>
			typeof m === "object" && m !== null && "role" in m && m.role === "system"
				? { role: "system", content: "You are a helpful assistant." }
				: m,
		);
	}
	return JSON.stringify(copy);
}

// ─── live verification (opt-in, paid) ───────────────────────────────────────

function ompFactoryToken(): string | null {
	const dbPath = path.join(OMP_HOME, "agent", "agent.db");
	if (!fs.existsSync(dbPath)) return null;
	const db = new Database(dbPath, { readonly: true });
	try {
		const row = db
			.query(
				`SELECT data FROM auth_credentials
				 WHERE provider = 'factory' AND credential_type = 'oauth' AND disabled_cause IS NULL
				 ORDER BY updated_at DESC LIMIT 1`,
			)
			.get() as { data: string } | null;
		if (!row) return null;
		const parsed = JSON.parse(row.data) as { access?: unknown };
		return typeof parsed.access === "string" ? parsed.access : null;
	} finally {
		db.close();
	}
}

async function forwardOnce(
	url: string,
	body: string,
	token: string,
	headers: Record<string, string>,
): Promise<string> {
	const controller = new AbortController();
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { ...headers, Authorization: `Bearer ${token}` },
			body,
			signal: controller.signal,
		});
		if (res.ok) {
			const reader = res.body!.getReader();
			await reader.read();
			controller.abort();
			return "200";
		}
		return `${res.status}`;
	} catch (error) {
		return `err:${error instanceof Error ? error.name : "unknown"}`;
	} finally {
		controller.abort();
	}
}

// ─── droid driving ──────────────────────────────────────────────────────────

function droidVersion(): string {
	const result = spawnSync("droid", ["--version"], { encoding: "utf8", timeout: 30_000 });
	const version = (result.stdout ?? "").trim().split("\n")[0];
	if (result.status !== 0 || !version) {
		throw new Error(`droid --version failed: ${result.stderr?.trim() || "not found on PATH"}`);
	}
	return version;
}

function runDroid(model: string, baseUrl: string, cwd: string): Promise<void> {
	// MUST be async: spawnSync would block the event loop and deadlock the
	// loopback capture server running in this same process.
	const { promise, resolve } = Promise.withResolvers<void>();
	const child = spawn("droid", ["exec", "-m", model, "--skip-permissions-unsafe", "Reply with exactly: ok"], {
		cwd,
		env: { ...process.env, FACTORY_API_BASE_URL: baseUrl },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		resolve();
	}, 120_000);
	// Droid-side errors AFTER the request lands are expected: the canned SSE
	// is intentionally minimal. Capture is what matters.
	child.on("close", () => {
		clearTimeout(timer);
		resolve();
	});
	child.on("error", () => {
		clearTimeout(timer);
		resolve();
	});
	return promise;
}

// ─── snapshot diff ──────────────────────────────────────────────────────────

function flattenForDiff(value: unknown, prefix: string, out: Map<string, string>): void {
	if (typeof value !== "object" || value === null) {
		out.set(prefix, JSON.stringify(value));
		return;
	}
	if (Array.isArray(value)) {
		out.set(`${prefix}[]`, `array(${value.length})`);
		value.forEach((item, index) => flattenForDiff(item, `${prefix}[${index}]`, out));
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		flattenForDiff(child, prefix ? `${prefix}.${key}` : key, out);
	}
}

function diffSnapshots(oldSnap: Snapshot, newSnap: Snapshot): string[] {
	const changes: string[] = [];
	const routes = new Set([...Object.keys(oldSnap.routes), ...Object.keys(newSnap.routes)]);
	for (const route of routes) {
		const oldFlat = new Map<string, string>();
		const newFlat = new Map<string, string>();
		const oldRoute = oldSnap.routes[route as RouteProbe["route"]];
		const newRoute = newSnap.routes[route as RouteProbe["route"]];
		if (oldRoute) flattenForDiff(oldRoute, "", oldFlat);
		if (newRoute) flattenForDiff(newRoute, "", newFlat);
		for (const key of new Set([...oldFlat.keys(), ...newFlat.keys()])) {
			if (key.endsWith("sha256")) continue; // reported via length/firstLine context
			const before = oldFlat.get(key);
			const after = newFlat.get(key);
			if (before === after) continue;
			const label = `${route}.${key || "(root)"}`;
			if (before === undefined) changes.push(`  + ${label}: ${after}`);
			else if (after === undefined) changes.push(`  - ${label}: ${before}`);
			else changes.push(`  ~ ${label}: ${before} → ${after}`);
		}
		const oldSha = oldRoute?.systemChannel.sha256;
		const newSha = newRoute?.systemChannel.sha256;
		if (oldSha && newSha && oldSha !== newSha) {
			changes.push(
				`  ~ ${route}.systemChannel: content changed (${oldRoute?.systemChannel.length} → ${newRoute?.systemChannel.length} chars)`,
			);
		}
	}
	return changes;
}

function compareDroidSnapshotVersions(left: string, right: string): number {
	const parseVersion = (filename: string) =>
		filename.replace(/^droid-/, "").replace(/\.json$/, "").split(".").map(Number);
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);

	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}

	return 0;
}

function loadSnapshot(ref: string): Snapshot {
	// Explicit paths (absolute or cwd-relative) resolve as given; bare
	// filenames and version strings resolve inside the snapshot dir.
	const candidate = ref.endsWith(".json")
		? fs.existsSync(ref)
			? ref
			: path.join(SNAPSHOT_DIR, ref)
		: path.join(SNAPSHOT_DIR, `droid-${ref}.json`);
	return JSON.parse(fs.readFileSync(candidate, "utf8")) as Snapshot;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return the snapshot at `snapshotPath` only when it is a COMPLETE capture of
 * `expectedVersion`: current schema, matching droid version, and a non-null
 * object entry for every route in ROUTE_MATRIX. Anything else — missing,
 * malformed, wrong version/schema, or partial — returns null so the caller
 * recaptures instead of trusting an unproven file.
 */
export function readCompleteSnapshot(snapshotPath: string, expectedVersion: string): Snapshot | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
	} catch {
		return null;
	}
	if (!isObject(parsed)) return null;
	if (parsed.schemaVersion !== 1) return null;
	if (parsed.droidVersion !== expectedVersion) return null;
	if (typeof parsed.capturedAt !== "string") return null;
	if (!isObject(parsed.routes)) return null;
	const routes = parsed.routes;
	for (const probe of ROUTE_MATRIX) {
		if (!isObject(routes[probe.route])) return null;
	}
	return parsed as unknown as Snapshot;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const verifyLive = args.includes("--verify-live");
	const diffIndex = args.indexOf("--diff");

	if (diffIndex !== -1) {
		const [a, b] = [args[diffIndex + 1], args[diffIndex + 2]];
		if (!a || !b) throw new Error("--diff requires two snapshot refs (version or path)");
		const changes = diffSnapshots(loadSnapshot(a), loadSnapshot(b));
		console.log(changes.length === 0 ? "no contract changes" : changes.join("\n"));
		return;
	}

	const version = droidVersion();
	const snapshotPath = path.join(SNAPSHOT_DIR, `droid-${version}.json`);
	const existingSnapshot = readCompleteSnapshot(snapshotPath, version);

	// Reuse a complete same-version capture: the contract is a pure function of
	// the installed Droid build, so rerunning `droid exec` three times proves
	// nothing new. --verify-live still recaptures: its paid attestation needs the
	// transient raw bodies and headers that committed snapshots omit by design.
	if (existingSnapshot && !verifyLive) {
		console.log(`contract already captured for droid ${version}; skipping`);
		return;
	}

	console.log(`capturing contract for droid ${version}`);

	const captured = new Map<RouteProbe["route"], RouteCapture & { rawBody: string; fwdHeaders: Record<string, string> }>();
	const seenHashes = new Set<string>();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const probe = ROUTE_MATRIX.find(p => url.pathname.includes(p.pathFragment));
			if (!probe) {
				await req.text();
				return new Response("{}");
			}
			const rawBody = await req.text();
			const hash = `${probe.route}:${sha256(rawBody).slice(0, 16)}`;
			if (!seenHashes.has(hash)) {
				seenHashes.add(hash);
				const headers: Record<string, string> = {};
				for (const [name, value] of req.headers.entries()) {
					if (SENSITIVE_HEADER.test(name) || SNAPSHOT_SKIP_HEADER.test(name)) continue;
					if (VOLATILE_HEADER.test(name)) {
						headers[name] = "<dynamic>";
					} else if (ENV_HEADER.test(name)) {
						headers[name] = "<environment>";
					} else if (name === "x-factory-org-id") {
						// Presence is contract-relevant; the org identifier is not.
						headers[name] = "<configured>";
					} else {
						headers[name] = value;
					}
				}
				const parsed = JSON.parse(rawBody) as Record<string, unknown>;
				const body: Record<string, unknown> = {};
				const channelKey = SYSTEM_CHANNEL_KEYS[probe.route];
				for (const [key, value] of Object.entries(parsed)) {
					if (key === channelKey) continue; // proprietary prompt — metadata only
					body[key] = shapeBodyValue(key, value);
				}
				fs.mkdirSync(PROMPT_DIR, { recursive: true });
				const systemChannel = extractSystemChannel(probe.route, parsed, (route, text) => {
					fs.writeFileSync(path.join(PROMPT_DIR, `droid-${version}-system-${route}.txt`), text, { mode: 0o600 });
				});
				const fwdHeaders: Record<string, string> = { "Content-Type": "application/json" };
				for (const [name, value] of req.headers.entries()) {
					if (SENSITIVE_HEADER.test(name) || SKIP_HEADER.test(name)) continue;
					fwdHeaders[name] = value;
				}
				captured.set(probe.route, {
					method: req.method,
					path: url.pathname,
					headers,
					body,
					toolsCount: Array.isArray(parsed.tools) ? parsed.tools.length : undefined,
					systemChannel,
					rawBody,
					fwdHeaders,
				});
				console.log(`  captured ${probe.route} (${rawBody.length} bytes)`);
			}
			return new Response(CANNED_SSE[probe.route], { headers: { "Content-Type": "text/event-stream" } });
		},
	});

	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-contract-"));
	try {
		for (const probe of ROUTE_MATRIX) {
			await runDroid(probe.model, `http://127.0.0.1:${server.port}`, workdir);
			if (!captured.has(probe.route)) {
				console.warn(`  WARNING: no ${probe.route} request captured for model ${probe.model}`);
			}
		}
	} finally {
		server.stop();
		fs.rmSync(workdir, { recursive: true, force: true });
	}

	// A partial snapshot would manufacture phantom removals in future diffs;
	// fail instead of writing one.
	const missingRoutes = ROUTE_MATRIX.filter(probe => !captured.has(probe.route)).map(probe => probe.route);
	if (missingRoutes.length > 0) {
		throw new Error(
			`capture incomplete: no request captured for ${missingRoutes.join(", ")}. ` +
				"Snapshot NOT written. Check `droid exec -m <model>` works for the route matrix models.",
		);
	}

	const snapshot: Snapshot = {
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		droidVersion: version,
		routes: {},
	};

	for (const probe of ROUTE_MATRIX) {
		const capture = captured.get(probe.route);
		if (!capture) continue;
		const { rawBody: _rawBody, fwdHeaders: _fwdHeaders, ...entry } = capture;
		snapshot.routes[probe.route] = entry;
	}

	fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

	// Live verification is a separate point-in-time artifact; it runs before
	// the contract equality check so --verify-live is never skipped by an
	// unchanged contract.
	if (verifyLive) {
		const ompToken = ompFactoryToken();
		if (!ompToken) {
			console.warn("  --verify-live: no active Factory OAuth credential in the omp auth DB; skipping live bisect");
		} else {
			const verifySnapshot: VerifySnapshot = {
				schemaVersion: 1,
				capturedAt: new Date().toISOString(),
				droidVersion: version,
				routes: {},
			};
			for (const probe of ROUTE_MATRIX) {
				const capture = captured.get(probe.route);
				if (!capture) continue;
				const parsed = JSON.parse(capture.rawBody) as Record<string, unknown>;
				verifySnapshot.routes[probe.route] = {
					verbatimOmpToken: await forwardOnce(probe.realUrl, capture.rawBody, ompToken, capture.fwdHeaders),
					systemStripped: await forwardOnce(probe.realUrl, stripSystemChannel(probe.route, parsed), ompToken, capture.fwdHeaders),
					genericContent: await forwardOnce(probe.realUrl, genericSystemChannel(probe.route, parsed), ompToken, capture.fwdHeaders),
				};
				const result = verifySnapshot.routes[probe.route]!;
				console.log(
					`  verify ${probe.route}: verbatim=${result.verbatimOmpToken} stripped=${result.systemStripped} generic=${result.genericContent}`,
				);
			}
			const verifyPath = path.join(SNAPSHOT_DIR, `droid-${version}.verify.json`);
			fs.writeFileSync(verifyPath, `${JSON.stringify(verifySnapshot, null, 2)}\n`);
			console.log(`verification written: ${path.relative(REPO_ROOT, verifyPath)}`);
		}
	}

	const previousSnapshots = fs.existsSync(SNAPSHOT_DIR)
		? fs
				.readdirSync(SNAPSHOT_DIR)
				.filter(
					f => f.startsWith("droid-") && f.endsWith(".json") && !f.endsWith(".verify.json") && f !== `droid-${version}.json`,
				)
				.sort(compareDroidSnapshotVersions)
		: [];

	// existingSnapshot is null unless the file was a COMPLETE same-version
	// capture, so a malformed current-version file is replaced by this run's
	// proven snapshot instead of short-circuiting the write.
	if (existingSnapshot && JSON.stringify(existingSnapshot.routes) === JSON.stringify(snapshot.routes)) {
		console.log(`no changes vs existing ${path.basename(snapshotPath)}`);
		return;
	}
	fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
	console.log(`snapshot written: ${path.relative(REPO_ROOT, snapshotPath)}`);

	const baseline = previousSnapshots.at(-1);
	if (baseline) {
		const changes = diffSnapshots(loadSnapshot(baseline), snapshot);
		console.log(changes.length === 0 ? `no contract changes vs ${baseline}` : `changes vs ${baseline}:\n${changes.join("\n")}`);
	} else {
		console.log("first snapshot — future droid upgrades will auto-diff against this one");
	}
}

// Guarded so readCompleteSnapshot can be imported (tests, tooling) without
// spawning Droid as an import side effect.
if (import.meta.main) {
	await main();
}
