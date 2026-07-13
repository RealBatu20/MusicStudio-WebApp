const VGMSTREAM_DEFAULT_BASE = "https://vgmstream.org/web/";
const FFLATE_MODULE_URL = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";
const MAX_ARCHIVE_BYTES = 768 * 1024 * 1024;

let vgmstreamWorker;
let vgmstreamReady;
let workerRequestId = 0;
let scanCancelled = false;
let activeScan = false;
let selectedFsbBankPath = null;
const workerRequests = new Map();

function fsbCacheKey(record) {
  return `fsb:${record.bankPath}#${record.subsong}`;
}

function getDecoderBaseUrl() {
  return ($("#decoderBaseInput")?.value || localStorage.getItem("ms-vgmstream-base") || VGMSTREAM_DEFAULT_BASE).trim().replace(/\/?$/, "/");
}

function ensureVgmstreamWorker() {
  if (vgmstreamWorker) return vgmstreamWorker;
  vgmstreamWorker = new Worker("./vgmstream-worker.js");
  vgmstreamWorker.onmessage = (event) => {
    const data = event.data || {};
    if (data.subject === "bank-progress") {
      updateDeepScanProgress(data.content);
      return;
    }
    const pending = workerRequests.get(data.id);
    if (!pending) return;
    workerRequests.delete(data.id);
    if (data.error) pending.reject(Object.assign(new Error(data.error.message || "vgmstream worker error"), data.error));
    else pending.resolve(data.content);
  };
  vgmstreamWorker.onerror = (error) => {
    for (const pending of workerRequests.values()) pending.reject(error);
    workerRequests.clear();
    vgmstreamReady = null;
  };
  return vgmstreamWorker;
}

function askVgmstream(subject, content = {}) {
  const worker = ensureVgmstreamWorker();
  const id = ++workerRequestId;
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject });
    worker.postMessage({ id, subject, content: { ...content, baseUrl: getDecoderBaseUrl() } });
  });
}

function loadVgmstream() {
  vgmstreamReady ||= askVgmstream("load", {});
  return vgmstreamReady;
}

function stopDeepScan() {
  scanCancelled = true;
  if (vgmstreamWorker) vgmstreamWorker.terminate();
  vgmstreamWorker = null;
  vgmstreamReady = null;
  for (const pending of workerRequests.values()) pending.reject(new Error("Scan cancelled"));
  workerRequests.clear();
  activeScan = false;
  $("#cancelScanBtn")?.classList.add("hidden");
  setStatus("Deep asset scan cancelled.");
}

function relativePathOf(file) {
  return file.relativePath || file.webkitRelativePath || file.name;
}

function pathDepth(path) {
  const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
  return Math.max(0, parts.length - 1);
}

function makeFileFromArchive(path, bytes) {
  const name = path.split("/").pop() || "asset.bin";
  const file = new File([bytes], name, { type: "application/octet-stream", lastModified: Date.now() });
  Object.defineProperty(file, "relativePath", { value: path, configurable: true });
  return file;
}

async function extractArchiveDeep(file) {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Archive is ${(file.size / 1024 / 1024).toFixed(0)} MB. Extract it first to avoid exhausting browser memory.`);
  }
  setStatus(`Opening nested archive ${file.name}…`);
  const { unzipSync } = await import(FFLATE_MODULE_URL);
  const unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const files = [];
  for (const [path, bytes] of Object.entries(unpacked)) {
    if (path.endsWith("/") || !bytes?.length) continue;
    files.push(makeFileFromArchive(`${file.name}/${path}`, bytes));
  }
  return files;
}

async function expandArchivesRecursively(seedFiles, maxDepth = 4) {
  const output = [...seedFiles];
  const queue = seedFiles
    .filter((file) => ARCHIVE_EXTENSIONS.test(file.name))
    .map((file) => ({ file, depth: 0 }));
  const visited = new Set();
  while (queue.length && !scanCancelled) {
    const { file, depth } = queue.shift();
    const key = `${relativePathOf(file)}:${file.size}:${file.lastModified}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (depth >= maxDepth) {
      setStatus(`Nested archive limit reached at ${relativePathOf(file)}.`);
      continue;
    }
    try {
      const extracted = await extractArchiveDeep(file);
      output.push(...extracted);
      for (const child of extracted) {
        if (ARCHIVE_EXTENSIONS.test(child.name)) queue.push({ file: child, depth: depth + 1 });
      }
    } catch (error) {
      console.warn(`Could not open archive ${relativePathOf(file)}`, error);
      setStatus(`Could not open ${relativePathOf(file)}: ${error.message}`);
    }
  }
  return output;
}

async function walkFileSystemHandle(handle, prefix = "") {
  const files = [];
  if (handle.kind === "file") {
    const file = await handle.getFile();
    Object.defineProperty(file, "relativePath", { value: `${prefix}${file.name}`, configurable: true });
    files.push(file);
    return files;
  }
  for await (const child of handle.values()) {
    files.push(...await walkFileSystemHandle(child, `${prefix}${handle.name}/`));
  }
  return files;
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const batch = () => reader.readEntries((items) => {
      if (!items.length) resolve(entries);
      else { entries.push(...items); batch(); }
    }, reject);
    batch();
  });
}

async function walkDropEntry(entry, prefix = "") {
  if (entry.isFile) {
    return new Promise((resolve, reject) => entry.file((file) => {
      Object.defineProperty(file, "relativePath", { value: `${prefix}${file.name}`, configurable: true });
      resolve([file]);
    }, reject));
  }
  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries(entry.createReader());
    const files = [];
    for (const child of children) files.push(...await walkDropEntry(child, `${prefix}${entry.name}/`));
    return files;
  }
  return [];
}

async function collectDroppedFiles(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...(dataTransfer.files || [])];
  const files = [];
  for (const entry of entries) files.push(...await walkDropEntry(entry));
  return files;
}

async function importDefinitionsFromFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const definitions = data.sound_definitions || {};
    const ids = Object.keys(definitions);
    if (!ids.length) return false;
    state.soundDefinitions = { ...state.soundDefinitions, ...definitions };
    state.sounds = sortSounds([...state.sounds, ...ids]);
    state.scanStats.definitions += ids.length;
    renderCategories();
    renderSoundList();
    return true;
  } catch (error) {
    console.warn(`Could not parse ${relativePathOf(file)}`, error);
    return false;
  }
}

function aliasesForStreamName(name) {
  const normalized = normalizePath(name || "");
  const noSounds = normalized.replace(/^sounds\//, "");
  const basename = noSounds.split("/").pop() || noSounds;
  return new Set([
    normalized,
    noSounds,
    `sounds/${noSounds}`,
    basename,
    noSounds.replaceAll("/", "."),
    basename.replaceAll("_", ".")
  ].filter(Boolean));
}

function addFsbStreamRecord(bank, stream) {
  const guessedName = stream.streamName || `${bank.name.replace(/\.fsb$/i, "")}#${stream.streamIndex}`;
  const record = {
    kind: "fsb",
    cacheKey: `fsb:${bank.relativePath}#${stream.streamIndex}`,
    path: normalizePath(guessedName),
    name: guessedName,
    type: "audio/x-fsb",
    bankPath: bank.relativePath,
    bankName: bank.name,
    file: bank.file,
    subsong: stream.streamIndex,
    streamCount: bank.streamCount,
    durationSeconds: stream.durationSeconds,
    encoding: stream.encoding,
    sampleRate: stream.sampleRate,
    channels: stream.channels
  };
  state.fsbStreams.set(record.cacheKey, record);
  aliasesForStreamName(guessedName).forEach((alias) => {
    if (!state.audioIndex.has(alias)) state.audioIndex.set(alias, record);
  });
  return record;
}

function matchDefinitionCount() {
  let matched = 0;
  for (const soundId of state.sounds) if (resolveAudioFile(soundId)) matched++;
  state.scanStats.matched = matched;
  return matched;
}

async function indexFsbBank(file) {
  if (scanCancelled) return;
  const relativePath = relativePathOf(file);
  $("#scanCurrentFile").textContent = relativePath;
  setStatus(`Indexing FSB bank ${relativePath}…`);
  const info = await askVgmstream("inspect-bank", { file, relativePath });
  const bank = {
    relativePath,
    name: file.name,
    file,
    streamCount: info.streamCount,
    streams: info.streams
  };
  state.fsbBanks.set(relativePath, bank);
  for (const stream of info.streams) addFsbStreamRecord(bank, stream);
  state.scanStats.fsbBanks = state.fsbBanks.size;
  state.scanStats.fsbStreams = state.fsbStreams.size;
  renderFsbBanks();
  updateAudioStatus();
  renderSoundList();
}

function updateDeepScanProgress(progress = {}) {
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  const percent = total ? Math.round((current / total) * 100) : 0;
  const bar = $("#scanProgressBar");
  if (bar) bar.style.width = `${percent}%`;
  if ($("#scanProgressText")) $("#scanProgressText").textContent = total ? `${current.toLocaleString()} / ${total.toLocaleString()} streams` : "Scanning…";
  if (progress.relativePath && $("#scanCurrentFile")) $("#scanCurrentFile").textContent = progress.relativePath;
  updateScanStatsUi();
}

function updateScanStatsUi() {
  const stats = state.scanStats;
  const entries = {
    scanFilesStat: stats.files,
    scanDepthStat: stats.depth,
    scanDirectStat: stats.directAudio,
    scanBanksStat: stats.fsbBanks,
    scanStreamsStat: stats.fsbStreams,
    scanMatchedStat: stats.matched
  };
  for (const [id, value] of Object.entries(entries)) {
    const el = $(`#${id}`);
    if (el) el.textContent = Number(value || 0).toLocaleString();
  }
}

async function deepScanAssets(inputFiles, remember = false) {
  if (activeScan) stopDeepScan();
  activeScan = true;
  scanCancelled = false;
  $("#cancelScanBtn")?.classList.remove("hidden");
  $("#scanProgressBar").style.width = "0%";
  $("#scanProgressText").textContent = "Discovering nested files…";

  let files = await expandArchivesRecursively([...inputFiles]);
  files = [...new Map(files.map((file) => [`${relativePathOf(file)}:${file.size}:${file.lastModified}`, file])).values()];

  state.scanStats = {
    files: files.length,
    depth: files.reduce((max, file) => Math.max(max, pathDepth(relativePathOf(file))), 0),
    directAudio: 0,
    fsbBanks: state.fsbBanks.size,
    fsbStreams: state.fsbStreams.size,
    definitions: 0,
    matched: 0
  };
  updateScanStatsUi();

  const definitions = files.filter((file) => /(^|\/)sound_definitions\.json$/i.test(relativePathOf(file)) || /^sound_definitions\.json$/i.test(file.name));
  for (const file of definitions) {
    if (scanCancelled) break;
    await importDefinitionsFromFile(file);
  }

  const direct = files.filter((file) => AUDIO_EXTENSIONS.test(file.name));
  if (direct.length) {
    indexAudioFiles(direct, remember);
    state.scanStats.directAudio += direct.length;
  }

  const banks = files.filter((file) => FSB_EXTENSIONS.test(file.name));
  if (!banks.length && !direct.length) {
    const minPackHint = files.some((file) => /sound_definitions\.json$/i.test(file.name));
    setStatus(minPackHint
      ? "Sound definitions were found, but no .fsb or normal audio files exist. This may be the text-only/min Bedrock Samples archive; use the full release."
      : "No .fsb, .ogg, .wav, .mp3, .m4a, .aac, .flac, or .opus audio was found in any nested folder.");
  }

  if (banks.length) {
    try {
      await loadVgmstream();
      $("#decoderStatus").textContent = "vgmstream WebAssembly is ready.";
      $("#decoderStatus").classList.remove("error");
    } catch (error) {
      console.error(error);
      setStatus(`FSB decoder failed: ${error.message}. Check the decoder URL or network connection.`);
      $("#decoderStatus").textContent = `Decoder error: ${error.message}`;
      $("#decoderStatus").classList.add("error");
    }
  }
  for (let index = 0; index < banks.length && !scanCancelled; index++) {
    $("#scanProgressText").textContent = `Bank ${index + 1} / ${banks.length}`;
    try {
      await indexFsbBank(banks[index]);
    } catch (error) {
      console.warn(`Could not index ${relativePathOf(banks[index])}`, error);
      setStatus(`Skipped ${relativePathOf(banks[index])}: ${error.message}`);
    }
  }

  matchDefinitionCount();
  state.scanStats.fsbBanks = state.fsbBanks.size;
  state.scanStats.fsbStreams = state.fsbStreams.size;
  updateScanStatsUi();
  updateDeepScanProgress({ current: 1, total: 1 });
  activeScan = false;
  $("#cancelScanBtn")?.classList.add("hidden");
  $("#audioDialogStatus").textContent = `${state.scanStats.files.toLocaleString()} files searched across ${state.scanStats.depth} folder levels. ${state.scanStats.fsbStreams.toLocaleString()} FSB streams indexed; ${state.scanStats.matched.toLocaleString()} sound IDs matched.`;
  if (!scanCancelled) setStatus(`Deep scan complete: ${state.scanStats.fsbBanks} FSB banks, ${state.scanStats.fsbStreams} streams, ${state.scanStats.directAudio} normal audio files.`);
}

async function decodeFsbRecord(record) {
  const result = await askVgmstream("decode-subsong", { file: record.file, subsong: record.subsong });
  return result.arrayBuffer;
}

function renderFsbBanks() {
  const host = $("#fsbBankList");
  if (!host) return;
  host.replaceChildren();
  const banks = [...state.fsbBanks.values()];
  if (!banks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>No FSB banks indexed</strong><span>Choose the full Bedrock Samples folder or archive. Every nested folder is searched.</span>";
    host.append(empty);
    return;
  }
  for (const bank of banks) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bank-row";
    row.innerHTML = `<span class="bank-icon">FSB</span><span><strong>${escapeHtml(bank.name)}</strong><small>${escapeHtml(bank.relativePath)}</small></span><b>${bank.streamCount.toLocaleString()}</b>`;
    row.classList.toggle("selected", bank.relativePath === selectedFsbBankPath);
    row.onclick = () => { selectedFsbBankPath = bank.relativePath; renderFsbBanks(); renderFsbStreams(bank.relativePath); };
    host.append(row);
  }
}

function renderFsbStreams(bankPath = selectedFsbBankPath) {
  const host = $("#fsbStreamList");
  if (!host) return;
  host.replaceChildren();
  const query = ($("#fsbStreamSearch")?.value || "").trim().toLowerCase();
  let streams = [...state.fsbStreams.values()];
  if (bankPath) streams = streams.filter((record) => record.bankPath === bankPath);
  if (query) streams = streams.filter((record) => `${record.name} ${record.bankName}`.toLowerCase().includes(query));
  const totalMatches = streams.length;
  streams = streams.slice(0, 1500);
  for (const record of streams) {
    const row = document.createElement("div");
    row.className = "stream-row";
    const details = [record.encoding, record.sampleRate ? `${record.sampleRate} Hz` : "", record.durationSeconds ? `${record.durationSeconds.toFixed(2)}s` : ""].filter(Boolean).join(" · ");
    row.innerHTML = `<button type="button" class="stream-preview" title="Preview decoded FSB subsong">▶</button><span><strong>${escapeHtml(record.name)}</strong><small>#${record.subsong} · ${escapeHtml(details || record.bankName)}</small></span><button type="button" class="stream-map" title="Map this stream to the currently selected Bedrock sound ID">MAP</button>`;
    row.querySelector(".stream-preview").onclick = async () => {
      const channel = state.channels[state.selectedChannel] || { volume: .75, pitch: 1, pan: 0, filter: 20000, delay: 0, mute: false, solo: false };
      const buffer = await decodeAudioRecord(record);
      if (!buffer) return setStatus(`Could not decode ${record.name}.`);
      const source = getAudioContext().createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = channel.pitch || 1;
      connectChannelFx(source, channel, getAudioContext().currentTime, buffer.duration, .85);
      source.start();
      setStatus(`Previewing ${record.name} from ${record.bankName}.`);
    };
    row.querySelector(".stream-map").onclick = () => {
      state.manualAudioMappings.set(state.selectedSound, record.cacheKey);
      setStatus(`Mapped ${state.selectedSound} to ${record.name}.`);
      renderSoundList();
      matchDefinitionCount();
      updateScanStatsUi();
    };
    host.append(row);
  }
  if (totalMatches > streams.length) {
    const note = document.createElement("div");
    note.className = "empty-state compact";
    note.innerHTML = `<strong>Showing ${streams.length.toLocaleString()} of ${totalMatches.toLocaleString()}</strong><span>Refine the stream search to narrow the list.</span>`;
    host.append(note);
  }
  if (!streams.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>No matching streams</strong><span>Index a bank or change the stream search.</span>";
    host.append(empty);
  }
}

async function chooseDeepDirectory() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      const files = await walkFileSystemHandle(handle);
      await deepScanAssets(files, $("#rememberAudioInput").checked);
      return;
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(`Directory scan failed: ${error.message}`);
      return;
    }
  }
  $("#audioFolderInput").click();
}

function bindFsbUi() {
  $("#deepFolderBtn")?.addEventListener("click", chooseDeepDirectory);
  $("#cancelScanBtn")?.addEventListener("click", stopDeepScan);
  $("#decoderBaseInput")?.addEventListener("change", (event) => {
    localStorage.setItem("ms-vgmstream-base", event.target.value.trim());
    if (vgmstreamWorker) vgmstreamWorker.terminate();
    vgmstreamWorker = null;
    vgmstreamReady = null;
    $("#decoderStatus").textContent = "Decoder URL changed. It will reload on the next FSB scan.";
  });
  $("#testDecoderBtn")?.addEventListener("click", async () => {
    $("#decoderStatus").textContent = "Loading vgmstream WebAssembly…";
    $("#decoderStatus").classList.remove("error");
    try {
      await loadVgmstream();
      $("#decoderStatus").textContent = "vgmstream WebAssembly is ready.";
      setStatus("FSB decoder ready.");
    } catch (error) {
      $("#decoderStatus").textContent = `Decoder error: ${error.message}`;
      $("#decoderStatus").classList.add("error");
    }
  });
  $("#fsbStreamSearch")?.addEventListener("input", () => renderFsbStreams(selectedFsbBankPath));
}
