"use strict";

let runtimePromise = null;
let decoderBase = "https://vgmstream.org/web/";
let stdoutBuffer = "";
let stderrBuffer = "";

function cleanError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || "",
    stdout: error?.stdout || "",
    stderr: error?.stderr || ""
  };
}

function normalizeBase(value) {
  const base = String(value || decoderBase).trim();
  return (base || decoderBase).replace(/\/?$/, "/");
}

async function loadRuntime(baseUrl) {
  if (runtimePromise) return runtimePromise;
  decoderBase = normalizeBase(baseUrl);
  runtimePromise = new Promise(async (resolve, reject) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(true); } };
    const fail = (error) => { if (!settled) { settled = true; reject(error instanceof Error ? error : new Error(String(error))); } };
    self.Module = {
      noInitialRun: true,
      locateFile: (name) => `${decoderBase}${name}`,
      print: (text) => { stdoutBuffer += `${text}\n`; },
      printErr: (text) => { stderrBuffer += `${text}\n`; },
      onRuntimeInitialized: finish,
      onAbort: fail,
      preRun: [() => {
        try {
          FS.init(undefined,
            (code) => { if (code !== null) stdoutBuffer += String.fromCharCode(code); },
            (code) => { if (code !== null) stderrBuffer += String.fromCharCode(code); });
        } catch (_) {}
      }]
    };
    try {
      const response = await fetch(`${decoderBase}vgmstream-cli.js`, { cache: "force-cache", mode: "cors" });
      if (!response.ok) throw new Error(`Decoder script HTTP ${response.status}`);
      const source = await response.text();
      (0, eval)(source);
      setTimeout(() => {
        if (!settled && typeof callMain === "function" && typeof FS !== "undefined") finish();
      }, 12000);
    } catch (error) {
      fail(new Error(`Unable to load vgmstream WebAssembly from ${decoderBase}: ${error.message}`));
    }
  });
  try { return await runtimePromise; }
  catch (error) { runtimePromise = null; throw error; }
}

function runCli(args) {
  stdoutBuffer = "";
  stderrBuffer = "";
  try { callMain(args); }
  catch (error) {
    if (!(error?.name === "ExitStatus" || error?.status === 0)) {
      error.stdout = stdoutBuffer;
      error.stderr = stderrBuffer;
      throw error;
    }
  }
  return { stdout: stdoutBuffer, stderr: stderrBuffer };
}

function parseMetadata(output) {
  const text = `${output.stdout || ""}\n${output.stderr || ""}`;
  const number = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*(\\d+)`, "i"));
    return match ? Number(match[1]) : null;
  };
  const value = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*([^\\r\\n]+)`, "i"));
    return match ? match[1].trim() : "";
  };
  const duration = text.match(/stream total samples:\s*\d+\s*\((\d+):([\d.]+) seconds\)/i);
  return {
    streamCount: number("stream count") || 1,
    streamIndex: number("stream index") || 1,
    streamName: value("stream name"),
    sampleRate: number("sample rate"),
    channels: number("channels"),
    encoding: value("encoding"),
    metadataFrom: value("metadata from"),
    durationSeconds: duration ? Number(duration[1]) * 60 + Number(duration[2]) : null,
    raw: text.trim()
  };
}

function safeName(file) {
  return String(file.name || "bank.fsb").replace(/[\\/]/g, "_");
}

function mountFile(file, callback) {
  const mount = `/in_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  FS.mkdir(mount);
  FS.mount(WORKERFS, { files: [file] }, mount);
  const previous = FS.cwd();
  FS.chdir(mount);
  try { return callback(safeName(file)); }
  finally {
    FS.chdir(previous);
    try { FS.unmount(mount); } catch (_) {}
    try { FS.rmdir(mount); } catch (_) {}
  }
}

function readVirtual(path) {
  try { return FS.readFile(path, { encoding: "binary" }); }
  catch (_) { return null; }
}

function removeVirtual(path) { try { FS.unlink(path); } catch (_) {} }

function probeBank(file) {
  return mountFile(file, (name) => {
    const output = runCli(["-m", "-s", "1", name]);
    const meta = parseMetadata(output);
    if (!meta.sampleRate && !meta.encoding && !meta.metadataFrom && !meta.raw) {
      const error = new Error("vgmstream could not recognize this FSB bank");
      error.stdout = output.stdout; error.stderr = output.stderr; throw error;
    }
    return meta;
  });
}

function inspectStream(file, index) {
  return mountFile(file, (name) => parseMetadata(runCli(["-m", "-s", String(index), name])));
}

function decodeStream(file, index) {
  return mountFile(file, (name) => {
    const out = `/out_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`;
    const result = runCli(["-o", out, "-i", "-s", String(index), name]);
    const bytes = readVirtual(out);
    removeVirtual(out);
    if (!bytes?.length) {
      const error = new Error("Decoder produced no WAV output");
      error.stdout = result.stdout; error.stderr = result.stderr; throw error;
    }
    const copy = new Uint8Array(bytes.length); copy.set(bytes);
    return { arrayBuffer: copy.buffer, stdout: result.stdout, stderr: result.stderr };
  });
}

self.onmessage = async (event) => {
  const { id, subject, content = {} } = event.data || {};
  try {
    await loadRuntime(content.baseUrl);
    let result;
    if (subject === "load") result = { ready: true, baseUrl: decoderBase };
    else if (subject === "probe-bank") result = probeBank(content.file);
    else if (subject === "inspect-stream") result = inspectStream(content.file, content.index || 1);
    else if (subject === "decode-stream") result = decodeStream(content.file, content.index || 1);
    else throw new Error(`Unknown decoder request: ${subject}`);
    if (result?.arrayBuffer) self.postMessage({ id, subject, content: result }, [result.arrayBuffer]);
    else self.postMessage({ id, subject, content: result });
  } catch (error) {
    self.postMessage({ id, subject, error: cleanError(error) });
  }
};
