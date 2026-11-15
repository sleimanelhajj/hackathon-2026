// Where agent code reports its work to the Logs (decision #67), without importing the database. The server switches it
// on at start (useAgentLog in index.js); until then, and in tests, these do nothing and asAgent just runs the work.

let log = null;

/** Called once by the server with the log from agent-log.js. */
export const useAgentLog = (agentLog) => { log = agentLog; };

/** Runs `fn` as an agent's task (team.js id). Inside another agent's run it becomes that agent's sub-agent run. */
export const asAgent = (opts, fn) => (log ? log.run(opts, fn) : fn());

/** One tool an agent used: name, arguments, what came back (summarised to a count, never stored as is). */
export const noteTool = (step) => { log?.tool(step); };

/** One Gemini call: model, Google's usage numbers, how long it took, whether it worked. */
export const noteModelCall = (call) => { log?.modelCall(call); };

/** Times `fn` and notes it as a tool step, passing its result or error through unchanged. */
export async function timedTool(name, args, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    noteTool({ name, args, result, durationMs: Date.now() - started, ok: !(result && typeof result === "object" && result.error) });
    return result;
  } catch (err) {
    noteTool({ name, args, durationMs: Date.now() - started, ok: false, error: err?.message ?? String(err) });
    throw err;
  }
}
