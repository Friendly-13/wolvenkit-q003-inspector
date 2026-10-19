import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "wolvenkit-q003-inspector";
const SERVER_VERSION = "0.1.0";
const MAX_SCRIPT_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 24 * 1024 * 1024;
const MAX_LINE_BYTES = 3 * 1024 * 1024;
const REPORT_MARKER = "WOLVENKIT_Q003_REPORT_V1:";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Q003_SCRIPT_NAME = "q003_wolvenkit_readonly_report.wscript";

function getExpectedRoot() {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("APPDATA is not set. This plugin expects a Windows WolvenKit installation.");
  }
  return path.resolve(appData, "REDModding", "WolvenKit", "WScript");
}

async function getRoot() {
  const expected = getExpectedRoot();
  try {
    const info = await fs.lstat(expected);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("The WolvenKit script location must be a regular directory: " + expected);
    }
    const root = await fs.realpath(expected);
    if (root.toLowerCase() !== expected.toLowerCase()) {
      throw new Error("The WolvenKit script directory resolves outside its configured location: " + expected);
    }
    return root;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("WolvenKit script directory was not found. Expected: " + expected);
    }
    throw error;
  }
}

function validateFilename(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("filename must be a non-empty .wscript filename.");
  }
  if (value !== value.trim()) {
    throw new Error("filename cannot start or end with whitespace.");
  }
  if (
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.endsWith(".") ||
    value.endsWith(" ")
  ) {
    throw new Error("Only a top-level script filename is allowed; paths and special names are rejected.");
  }
  if (!/^[^<>:"/\\|?*\u0000-\u001f]+\.wscript$/i.test(value)) {
    throw new Error("filename must contain only a valid Windows filename and end in .wscript.");
  }
  const stem = value.slice(0, -".wscript".length);
  if (stem.endsWith(".") || stem.endsWith(" ")) {
    throw new Error("filename cannot contain a trailing dot or space before .wscript.");
  }
  const windowsName = stem.split(".")[0].trimEnd();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(windowsName)) {
    throw new Error("filename uses a reserved Windows device name.");
  }
  return value;
}

async function getBackupDirectory(root) {
  const backupDirectory = path.join(root, ".codex-backups");
  try {
    await fs.mkdir(backupDirectory);
  } catch (error) {
    if (!error || error.code !== "EEXIST") {
      throw error;
    }
  }
  const info = await fs.lstat(backupDirectory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("The backup location must be a regular directory inside the WolvenKit script directory.");
  }
  const realPath = await fs.realpath(backupDirectory);
  if (path.dirname(realPath) !== root) {
    throw new Error("The backup location resolves outside the WolvenKit script directory.");
  }
  return realPath;
}

async function getScriptPath(filename, mustExist) {
  const root = await getRoot();
  const safeName = validateFilename(filename);
  const fullPath = path.resolve(root, safeName);
  const relativePath = path.relative(root, fullPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    path.dirname(fullPath) !== root
  ) {
    throw new Error("The requested script path is outside the WolvenKit script directory.");
  }

  let info;
  try {
    info = await fs.lstat(fullPath);
  } catch (error) {
    if (error && error.code === "ENOENT" && !mustExist) {
      return { root, filename: safeName, fullPath, exists: false };
    }
    if (error && error.code === "ENOENT") {
      throw new Error("Script not found: " + safeName);
    }
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("The requested path is not a regular script file.");
  }
  const realPath = await fs.realpath(fullPath);
  if (path.dirname(realPath) !== root) {
    throw new Error("The requested script resolves outside the WolvenKit script directory.");
  }
  return { root, filename: safeName, fullPath, exists: true, info };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function ensureContent(content) {
  if (typeof content !== "string") {
    throw new Error("content must be a string.");
  }
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength > MAX_SCRIPT_BYTES) {
    throw new Error("Script content is larger than the 1 MiB limit.");
  }
  return buffer;
}

async function listScripts() {
  const root = await getRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const scripts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.wscript$/i.test(entry.name)) {
      continue;
    }
    const candidate = path.join(root, entry.name);
    const info = await fs.lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile()) {
      continue;
    }
    scripts.push({
      filename: entry.name,
      size_bytes: info.size,
      modified_at: info.mtime.toISOString(),
      sha256: await sha256File(candidate),
    });
  }
  scripts.sort((left, right) => left.filename.localeCompare(right.filename));
  return { directory: root, scripts };
}

async function readScript(args) {
  const target = await getScriptPath(args.filename, true);
  const bytes = await fs.readFile(target.fullPath);
  if (bytes.byteLength > MAX_SCRIPT_BYTES) {
    throw new Error("Script is larger than the 1 MiB read limit.");
  }
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    throw new Error("Script is not valid UTF-8 and was not returned as editable text.");
  }
  return {
    filename: target.filename,
    path: target.fullPath,
    sha256: sha256(bytes),
    content,
  };
}

async function readLatestQ003Report() {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("APPDATA is not set. This plugin expects a Windows WolvenKit installation.");
  }
  const expected = path.resolve(appData, "REDModding", "WolvenKit", "Logs");
  let logRoot;
  try {
    const info = await fs.lstat(expected);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("The WolvenKit log location must be a regular directory: " + expected);
    }
    logRoot = await fs.realpath(expected);
    if (logRoot.toLowerCase() !== expected.toLowerCase()) {
      throw new Error("The WolvenKit log directory resolves outside its configured location: " + expected);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("WolvenKit log directory was not found. Expected: " + expected);
    }
    throw error;
  }
  const entries = await fs.readdir(logRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^applog\d{8}\.txt$/i.test(entry.name)) continue;
    const candidate = path.join(logRoot, entry.name);
    const info = await fs.lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_LOG_BYTES) continue;
    const realPath = await fs.realpath(candidate);
    if (path.dirname(realPath) !== logRoot) continue;
    candidates.push({ path: realPath, modifiedAt: info.mtime, sizeBytes: info.size });
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const candidate of candidates) {
    const text = await fs.readFile(candidate.path, "utf8");
    const markerIndex = text.lastIndexOf(REPORT_MARKER);
    if (markerIndex < 0) continue;
    const start = markerIndex + REPORT_MARKER.length;
    const end = text.indexOf("\n", start);
    const json = text.slice(start, end < 0 ? undefined : end).trim();
    let report;
    try {
      report = JSON.parse(json);
    } catch {
      throw new Error("The latest q003 report marker in " + path.basename(candidate.path) + " is not valid JSON. Rerun the report script in WolvenKit.");
    }
    if (!report || report.schemaVersion !== 1 || !Array.isArray(report.resources)) {
      throw new Error("The latest q003 report uses an unsupported format. Rerun the report script from this plugin.");
    }
    return {
      log_path: candidate.path,
      log_modified_at: candidate.modifiedAt.toISOString(),
      report,
    };
  }
  throw new Error("No q003 report was found in WolvenKit's application logs. Open the bundled q003 WScript in WolvenKit's Script Manager and run it, then call this tool again.");
}

async function loadQ003ReportScript() {
  const sourcePath = path.resolve(PLUGIN_ROOT, "scripts", Q003_SCRIPT_NAME);
  const sourceRoot = await fs.realpath(path.dirname(sourcePath));
  const sourceInfo = await fs.lstat(sourcePath);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    throw new Error("The bundled q003 script must be a regular file inside the plugin scripts directory.");
  }
  const realSource = await fs.realpath(sourcePath);
  if (path.dirname(realSource) !== sourceRoot) {
    throw new Error("The bundled q003 script must be inside the plugin scripts directory.");
  }
  const content = await fs.readFile(realSource);
  if (content.byteLength > MAX_SCRIPT_BYTES) {
    throw new Error("The bundled q003 script exceeds the 1 MiB limit.");
  }
  return content;
}

async function createScript(args) {
  const content = ensureContent(args.content);
  const target = await getScriptPath(args.filename, false);
  let handle;
  let created = false;
  try {
    handle = await fs.open(target.fullPath, "wx");
    created = true;
    await handle.writeFile(content);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error("Script already exists; use read_script and write_script to update it.");
    }
    if (created) await fs.rm(target.fullPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
  return {
    filename: target.filename,
    path: target.fullPath,
    sha256: sha256(content),
    size_bytes: content.byteLength,
  };
}

async function installQ003ReportScript() {
  const content = await loadQ003ReportScript();
  const target = await getScriptPath(Q003_SCRIPT_NAME, false);
  let handle;
  let created = false;
  try {
    handle = await fs.open(target.fullPath, "wx");
    created = true;
    await handle.writeFile(content);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error("A script with this name already exists. Read it first and use write_script with its current SHA-256 only if you intend to replace it.");
    }
    if (created) await fs.rm(target.fullPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (handle) await handle.close();
  }
  return {
    filename: Q003_SCRIPT_NAME,
    path: target.fullPath,
    sha256: sha256(content),
    size_bytes: content.byteLength,
    note: "Copied the bundled read-only report script. It only reads mounted archive resources and writes report text to WolvenKit's log.",
  };
}

async function updateQ003ReportScript(args) {
  if (typeof args.expected_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(args.expected_sha256)) {
    throw new Error("expected_sha256 is required. Read the existing q003 script first and pass its SHA-256 digest.");
  }
  const target = await getScriptPath(Q003_SCRIPT_NAME, true);
  const previous = await fs.readFile(target.fullPath);
  const currentHash = sha256(previous);
  if (currentHash.toLowerCase() !== args.expected_sha256.toLowerCase()) {
    throw new Error("The q003 script changed since it was read. Current SHA-256: " + currentHash + ". Read it again before updating.");
  }
  const content = await loadQ003ReportScript();
  const backupDirectory = await getBackupDirectory(target.root);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDirectory, target.filename + "." + timestamp + ".bak");
  await fs.writeFile(backupPath, previous, { flag: "wx" });
  const temporaryPath = path.join(target.root, "." + target.filename + "." + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temporaryPath, content, { flag: "wx" });
    const latest = await fs.readFile(target.fullPath);
    const latestHash = sha256(latest);
    if (latestHash.toLowerCase() !== args.expected_sha256.toLowerCase()) {
      throw new Error("The q003 script changed while the update was prepared. Current SHA-256: " + latestHash + ". Read it again before updating.");
    }
    await fs.rename(temporaryPath, target.fullPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return {
    filename: target.filename,
    path: target.fullPath,
    backup_path: backupPath,
    previous_sha256: currentHash,
    sha256: sha256(content),
    size_bytes: content.byteLength,
    note: "Updated only the WScript source. This report script reads mounted archive resources and writes report text to WolvenKit's log.",
  };
}

async function writeScript(args) {
  if (typeof args.expected_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(args.expected_sha256)) {
    throw new Error("expected_sha256 is required. Read the script first and pass its returned SHA-256 digest.");
  }
  const content = ensureContent(args.content);
  const target = await getScriptPath(args.filename, true);
  const previous = await fs.readFile(target.fullPath);
  const currentHash = sha256(previous);
  if (currentHash.toLowerCase() !== args.expected_sha256.toLowerCase()) {
    throw new Error("The script changed since it was read. Current SHA-256: " + currentHash + ". Read it again before editing.");
  }

  const backupDirectory = await getBackupDirectory(target.root);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDirectory, target.filename + "." + timestamp + ".bak");
  await fs.writeFile(backupPath, previous, { flag: "wx" });

  const temporaryPath = path.join(target.root, "." + target.filename + "." + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temporaryPath, content, { flag: "wx" });
    const latest = await fs.readFile(target.fullPath);
    const latestHash = sha256(latest);
    if (latestHash.toLowerCase() !== args.expected_sha256.toLowerCase()) {
      throw new Error("The script changed while the replacement was being prepared. Current SHA-256: " + latestHash + ". Read it again before editing.");
    }
    await fs.rename(temporaryPath, target.fullPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    filename: target.filename,
    path: target.fullPath,
    backup_path: backupPath,
    previous_sha256: currentHash,
    sha256: sha256(content),
    size_bytes: content.byteLength,
  };
}

const toolDefinitions = [
  {
    name: "read_q003_report",
    description: "Read the latest machine-readable q003 read-only metadata report emitted by the bundled WolvenKit script. Reads the WolvenKit application log and does not access or modify game resources.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "install_q003_report_script",
    description: "Copy the bundled q003 read-only WScript into WolvenKit's script directory, only if its filename does not already exist. Does not run it or modify game resources.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_q003_report_script",
    description: "Replace the q003 report WScript with this plugin's bundled version after checking the exact SHA-256 supplied from read_script. Saves a backup and does not run the script or modify game resources.",
    inputSchema: {
      type: "object",
      properties: { expected_sha256: { type: "string", description: "The exact SHA-256 returned by read_script for q003_wolvenkit_readonly_report.wscript." } },
      required: ["expected_sha256"],
      additionalProperties: false,
    },
  },
  {
    name: "get_script_directory",
    description: "Return the local WolvenKit WScript directory used by this server.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_scripts",
    description: "List top-level .wscript files in the local WolvenKit WScript directory with sizes, timestamps, and SHA-256 digests.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_script",
    description: "Read a top-level .wscript file from the local WolvenKit WScript directory. Returns its SHA-256 digest for a later safe update.",
    inputSchema: {
      type: "object",
      properties: { filename: { type: "string", description: "A filename ending in .wscript, without directory components." } },
      required: ["filename"],
      additionalProperties: false,
    },
  },
  {
    name: "create_script",
    description: "Create a new .wscript file in the local WolvenKit WScript directory. Fails if that filename already exists.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "A new filename ending in .wscript, without directory components." },
        content: { type: "string", description: "Complete JavaScript WScript source, at most 1 MiB." },
      },
      required: ["filename", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "write_script",
    description: "Safely replace an existing .wscript file after its current SHA-256 digest is checked. Saves the previous version in .codex-backups before replacement.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "An existing filename ending in .wscript, without directory components." },
        content: { type: "string", description: "Complete replacement JavaScript WScript source, at most 1 MiB." },
        expected_sha256: { type: "string", description: "The exact SHA-256 digest returned by read_script." },
      },
      required: ["filename", "content", "expected_sha256"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object.");
  }
  if (name === "read_q003_report") {
    return await readLatestQ003Report();
  }
  if (name === "install_q003_report_script") {
    return await installQ003ReportScript();
  }
  if (name === "update_q003_report_script") {
    return await updateQ003ReportScript(args);
  }
  if (name === "get_script_directory") {
    return { directory: await getRoot() };
  }
  if (name === "list_scripts") {
    return await listScripts();
  }
  if (name === "read_script") {
    return await readScript(args);
  }
  if (name === "create_script") {
    return await createScript(args);
  }
  if (name === "write_script") {
    return await writeScript(args);
  }
  throw new Error("Unknown tool: " + name);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (message && Object.hasOwn(message, "id")) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32600, message: "Invalid JSON-RPC request." } });
    }
    return;
  }
  if (message.method.startsWith("notifications/")) {
    return;
  }
  if (message.method === "initialize") {
    const requestedVersion = message.params && message.params.protocolVersion;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: typeof requestedVersion === "string" ? requestedVersion : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }
  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const params = message.params || {};
      const result = await callTool(params.name, params.arguments || {});
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        },
      });
    }
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
}

let inputBuffer = "";
let requestQueue = Promise.resolve();

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  if (Buffer.byteLength(inputBuffer, "utf8") > MAX_LINE_BYTES * 2) {
    process.stderr.write("Input buffer exceeded its safety limit.\n");
    process.exitCode = 1;
    process.stdin.pause();
    return;
  }
  let newline = inputBuffer.indexOf("\n");
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (line.length > 0) {
      requestQueue = requestQueue.then(async () => {
        if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
          send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Request exceeded the input limit." } });
          return;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } });
          return;
        }
        await handleMessage(message);
      }).catch((error) => {
        process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
      });
    }
    newline = inputBuffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  requestQueue.catch(() => {});
});

process.stdin.on("error", (error) => {
  process.stderr.write("stdin error: " + error.message + "\n");
});
