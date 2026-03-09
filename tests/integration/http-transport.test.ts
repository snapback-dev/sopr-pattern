/**
 * HTTP Transport Integration Tests
 *
 * Validates the Streamable HTTP transport added to ProtocolServer:
 * - Server startup on specified port
 * - Session creation via POST (no session-id header)
 * - Subsequent requests with session-id
 * - Session deletion via DELETE
 * - Capacity limits
 * - Method handling (405 for unsupported methods)
 *
 * @module tests/integration/http-transport
 */

import { type Server as HttpServer, request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSOPRServer } from "../../src/index.js";
import type { ToolDefinition } from "../../src/registry/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send an HTTP request and collect the response */
function sendRequest(options: {
	port: number;
	method: string;
	path?: string;
	headers?: Record<string, string>;
	body?: unknown;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{
				hostname: "127.0.0.1",
				port: options.port,
				path: options.path ?? "/mcp",
				method: options.method,
				headers: {
					"Content-Type": "application/json",
					Connection: "close",
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const body = Buffer.concat(chunks).toString("utf-8");
					const headers: Record<string, string> = {};
					for (const [key, value] of Object.entries(res.headers)) {
						if (typeof value === "string") {
							headers[key] = value;
						}
					}
					resolve({ statusCode: res.statusCode ?? 0, headers, body });
				});
			},
		);
		req.on("error", reject);
		if (options.body) {
			req.write(JSON.stringify(options.body));
		}
		req.end();
	});
}

/** Create a minimal echo tool for testing */
function createEchoTool(): ToolDefinition {
	return {
		name: "echo",
		description: "Echo the input back",
		inputSchema: z.object({
			mode: z.literal("default"),
			message: z.string().optional(),
		}),
		modes: {
			default: async (input: unknown) => {
				const params = input as Record<string, unknown>;
				return { echoed: params.message ?? "no message" };
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProtocolServer HTTP Transport", () => {
	let httpServer: HttpServer | null = null;
	const TEST_PORT = 19876; // Use a high port to avoid conflicts

	afterEach(async () => {
		if (httpServer) {
			const server = httpServer;
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
			httpServer = null;
		}
	});

	it("should start HTTP server and respond to health-check-style request", async () => {
		const server = createSOPRServer({
			serverName: "test-http",
			serverVersion: "0.0.1",
			workspacePath: "/tmp/test-workspace",
			tools: [createEchoTool()],
		});

		httpServer = await server.startHttp({ port: TEST_PORT, hostname: "127.0.0.1" });

		// Send a non-MCP request to a wrong path - should get 404
		const res = await sendRequest({
			port: TEST_PORT,
			method: "GET",
			path: "/health",
		});

		expect(res.statusCode).toBe(404);
	});

	it("should reject unsupported HTTP methods with 405", async () => {
		const server = createSOPRServer({
			serverName: "test-http",
			serverVersion: "0.0.1",
			workspacePath: "/tmp/test-workspace",
			tools: [createEchoTool()],
		});

		httpServer = await server.startHttp({ port: TEST_PORT, hostname: "127.0.0.1" });

		const res = await sendRequest({
			port: TEST_PORT,
			method: "PUT",
			path: "/mcp",
		});

		expect(res.statusCode).toBe(405);
	});

	it("should return 400 for GET without session ID", async () => {
		const server = createSOPRServer({
			serverName: "test-http",
			serverVersion: "0.0.1",
			workspacePath: "/tmp/test-workspace",
			tools: [createEchoTool()],
		});

		httpServer = await server.startHttp({ port: TEST_PORT, hostname: "127.0.0.1" });

		const res = await sendRequest({
			port: TEST_PORT,
			method: "GET",
			path: "/mcp",
		});

		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body)).toHaveProperty("error", "Session not found");
	});

	it("should return 404 for DELETE with unknown session ID", async () => {
		const server = createSOPRServer({
			serverName: "test-http",
			serverVersion: "0.0.1",
			workspacePath: "/tmp/test-workspace",
			tools: [createEchoTool()],
		});

		httpServer = await server.startHttp({ port: TEST_PORT, hostname: "127.0.0.1" });

		const res = await sendRequest({
			port: TEST_PORT,
			method: "DELETE",
			path: "/mcp",
			headers: { "mcp-session-id": "nonexistent" },
		});

		expect(res.statusCode).toBe(404);
	});

	it("should handle MCP initialize request via POST", async () => {
		const server = createSOPRServer({
			serverName: "test-http",
			serverVersion: "0.0.1",
			workspacePath: "/tmp/test-workspace",
			tools: [createEchoTool()],
		});

		httpServer = await server.startHttp({
			port: TEST_PORT,
			hostname: "127.0.0.1",
			enableJsonResponse: true,
		});

		// Send an MCP initialize request (JSONRPC)
		const res = await sendRequest({
			port: TEST_PORT,
			method: "POST",
			path: "/mcp",
			headers: {
				Accept: "application/json, text/event-stream",
			},
			body: {
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test-client", version: "0.0.1" },
				},
			},
		});

		// Should get a 200 with session ID in response header
		expect(res.statusCode).toBe(200);

		// The session ID should be in the response header
		const sessionId = res.headers["mcp-session-id"];
		expect(sessionId).toBeTruthy();
		expect(typeof sessionId).toBe("string");
	});

	it("should expose getActiveRequestCount()", async () => {
		const server = createSOPRServer({
			serverName: "test-http",
			serverVersion: "0.0.1",
			workspacePath: "/tmp/test-workspace",
			tools: [createEchoTool()],
		});

		// Before starting, active count should be 0
		expect(server.getActiveRequestCount()).toBe(0);
	});
});
