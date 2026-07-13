const VGMSTREAM_DEFAULT_BASE = "https://vgmstream.org/web/";
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
let vgmstreamWorker = null;
let vgmstreamReady = null;
let workerRequestId = 0;
let scanCancelled = false;
let activeScan = false;
let selectedFsbBankPath = null;
let selectedFsbRecord = null;
const workerRequests = new Map();

function getDecoderBaseUrl() {
  return ($("#decoderBaseInput")?.value || localStorage.getItem("ms-vgmstream-base") || VGMSTREAM_DEFAULT_BASE).trim().replace(/\/?$/, "/");
}
function ensureVgmstreamWorker() {
  if (vgmstreamWorker) return vgmstreamWorker;
  vgmstreamWorker = new Worker("./vgmstream-worker.js?v=4");
  vgmstreamWorker.onmessage = ({ data = {} }) => {
    const pending = workerRequests.get(data.id);
    if (!pending) return;
    workerRequests.delete(data.id);
    data.error ? pending.reject(Object.assign(new Error(data.error.message || "Decoder error"), data.error)) : pending.resolve(data.content);
  };
  vgmstreamWorker.onerror = (error) => {
    for (const pending of workerRequests.values()) pending.reject(error);
    workerRequests.clear(); vgmstreamReady = null;
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
function loadVgmstream() { return vgmstreamReady ||= askVgmstream("load"); }
function resetVgmstream() {
  vgmstreamWorker?.terminate(); vgmstreamWorker = null; vgmstreamReady = null;
  for (const pending of workerRequests.values()) pending.reject(new Error("Decoder reset"));
  workerRequests.clear();
}
function relativePathOf(file) { return file.relativePath || file.webkitRelativePath || file.name; }
function defineRelativePath(file, path) { try { Object.defineProperty(file, "relativePath", { value: path, configurable: true }); } catch (_) {} return file; }
function pathDepth(path) { return Math.max(0, String(path || "").replace(/\\/g, "/").split("/").filter(Boolean).length - 1); }
function makeArchiveFile(path, bytes) { return defineRelativePath(new File([bytes], path.split("/").pop() || "asset.bin", { type: "application/octet-stream" }), path); }

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }
async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) throw new Error("This browser cannot decompress ZIP entries. Use current Chrome, Edge, Firefox, or extract the archive first.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipFile(file) {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error(`Archive exceeds ${(MAX_ARCHIVE_BYTES / 1024 / 1024).toFixed(0)} MB. Extract it first.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = Math.max(0, bytes.length - 65557); i <= bytes.length - 22; i++) if (u32(view, i) === 0x06054b50) eocd = i;
  if (eocd < 0) throw new Error("ZIP end record not found");
  const total = u16(view, eocd + 10), centralOffset = u32(view, eocd + 16);
  const out = []; let cursor = centralOffset;
  const decoder = new TextDecoder();
  for (let n = 0; n < total && cursor + 46 <= bytes.length; n++) {
    if (u32(view, cursor) !== 0x02014b50) break;
    const method = u16(view, cursor + 10), compressed = u32(view, cursor + 20), uncompressed = u32(view, cursor + 24);
    const nameLen = u16(view, cursor + 28), extraLen = u16(view, cursor + 30), commentLen = u16(view, cursor + 32), localOffset = u32(view, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)).replace(/\\/g, "/");
    cursor += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/") || localOffset + 30 > bytes.length || u32(view, localOffset) !== 0x04034b50) continue;
    const localName = u16(view, localOffset + 26), localExtra = u16(view, localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const payload = bytes.subarray(start, start + compressed);
    let data;
    if (method === 0) data = payload.slice();
    else if (method === 8) data = await inflateRaw(payload);
    else continue;
    if (uncompressed && data.length !== uncompressed) console.warn("ZIP size mismatch", name, data.length, uncompressed);
    out.push(makeArchiveFile(`${relativePathOf(file)}/${name}`, data));
  }
  return out;
}
async function expandArchivesRecursively(seedFiles, maxDepth = 5) {
  const output = [...seedFiles], queue = seedFiles.filter((f) => ARCHIVE_EXTENSIONS.test(f.name)).map((file) => ({ file, depth: 0 }));
  const visited = new Set();
  while (queue.length && !scanCancelled) {
    const { file, depth } = queue.shift(); const key = `${relativePathOf(file)}:${file.size}`;
    if (visited.has(key) || depth >= maxDepth) continue; visited.add(key);
    try {
      setScanLog(`Extracting ${relativePathOf(file)}…`);
      const children = await unzipFile(file); output.push(...children);
      children.filter((f) => ARCHIVE_EXTENSIONS.test(f.name)).forEach((child) => queue.push({ file: child, depth: depth + 1 }));
    } catch (error) { setScanLog(`Archive skipped: ${relativePathOf(file)} — ${error.message}`, true); }
  }
  return output;
}
async function walkHandle(handle, prefix = "") {
  if (handle.kind === "file") return [defineRelativePath(await handle.getFile(), `${prefix}${handle.name}`)];
  const files = []; for await (const child of handle.values()) files.push(...await walkHandle(child, `${prefix}${handle.name}/`)); return files;
}
function readEntries(reader) { return new Promise((resolve, reject) => { const all=[]; const next=()=>reader.readEntries((batch)=>batch.length?(all.push(...batch),next()):resolve(all),reject); next(); }); }
async function walkEntry(entry, prefix="") {
  if (entry.isFile) return new Promise((resolve,reject)=>entry.file((file)=>resolve([defineRelativePath(file,`${prefix}${file.name}`)]),reject));
  if (!entry.isDirectory) return [];
  const files=[]; for (const child of await readEntries(entry.createReader())) files.push(...await walkEntry(child,`${prefix}${entry.name}/`)); return files;
}
async function collectDroppedFiles(dt) {
  const entries=[...(dt.items||[])].map((item)=>item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt.files||[])];
  const files=[]; for (const entry of entries) files.push(...await walkEntry(entry)); return files;
}
function setScanLog(text, error=false) {
  const log=$("#scanLog"); if (!log) return; const line=document.createElement("div"); line.className=error?"log-line error":"log-line"; line.textContent=text; log.prepend(line); while(log.children.length>120) log.lastChild.remove();
}
function updateScanUi() {
  const s=state.scanStats; const map={scanFilesStat:s.files,scanDepthStat:s.depth,scanDirectStat:s.directAudio,scanBanksStat:s.fsbBanks,scanStreamsStat:s.fsbStreams,scanMatchedStat:s.matched};
  Object.entries(map).forEach(([id,value])=>{const el=$(`#${id}`);if(el)el.textContent=Number(value||0).toLocaleString();});
}
async function importDefinition(file) {
  try { const data=JSON.parse(await file.text()); const defs=data.sound_definitions||{}; const ids=Object.keys(defs); if(!ids.length)return false; state.soundDefinitions={...state.soundDefinitions,...defs}; state.sounds=sortSounds([...state.sounds,...ids]); state.scanStats.definitions+=ids.length; return true; }
  catch(error){setScanLog(`Definition skipped: ${relativePathOf(file)} — ${error.message}`,true);return false;}
}
function streamCacheKey(bankPath,index){return `fsb:${bankPath}#${index}`;}
function recordForStream(bank,index,meta={}) {
  const key=streamCacheKey(bank.relativePath,index); let record=state.fsbStreams.get(key);
  if(!record){record={kind:"fsb",cacheKey:key,path:key,name:`Stream ${String(index).padStart(4,"0")}`,bankPath:bank.relativePath,bankName:bank.name,file:bank.file,subsong:index,streamCount:bank.streamCount};state.fsbStreams.set(key,record);}
  if(meta.streamName) record.name=meta.streamName;
  Object.assign(record,{durationSeconds:meta.durationSeconds??record.durationSeconds,encoding:meta.encoding||record.encoding,sampleRate:meta.sampleRate||record.sampleRate,channels:meta.channels||record.channels,inspected:Boolean(meta.raw||meta.streamName||meta.encoding)});
  if(record.inspected){
    const normalized=normalizePath(record.name); const aliases=new Set([normalized,normalized.replace(/^sounds\//,""),`sounds/${normalized.replace(/^sounds\//,"")}`,normalized.split("/").pop(),normalized.replaceAll("/",".")]);
    aliases.forEach((alias)=>{if(alias&&!state.audioIndex.has(alias))state.audioIndex.set(alias,record);});
  }
  return record;
}
async function probeBank(file) {
  const relativePath=relativePathOf(file); setScanLog(`Probing FSB: ${relativePath}`);
  const meta=await askVgmstream("probe-bank",{file}); const count=Math.max(1,meta.streamCount||1);
  const bank={relativePath,name:file.name,file,streamCount:count,indexed:new Set([1])}; state.fsbBanks.set(relativePath,bank); recordForStream(bank,1,meta);
  state.scanStats.fsbBanks=state.fsbBanks.size; state.scanStats.fsbStreams=[...state.fsbBanks.values()].reduce((n,b)=>n+b.streamCount,0); updateScanUi(); renderFsbBanks();
}
async function inspectRecord(record) {
  if(record.inspected)return record; const bank=state.fsbBanks.get(record.bankPath); if(!bank)throw new Error("FSB bank is no longer available");
  const meta=await askVgmstream("inspect-stream",{file:bank.file,index:record.subsong}); bank.indexed.add(record.subsong); recordForStream(bank,record.subsong,meta); return record;
}
async function decodeFsbRecord(record) {
  const bank=state.fsbBanks.get(record.bankPath); if(!bank)throw new Error("FSB bank is no longer available");
  const result=await askVgmstream("decode-stream",{file:bank.file,index:record.subsong}); return result.arrayBuffer;
}
async function indexBankRange(bank,start,end) {
  const cancelToken={cancelled:false}; bank.indexCancel=cancelToken; const total=end-start+1;
  for(let index=start;index<=end&&!cancelToken.cancelled;index++){
    const rec=recordForStream(bank,index); if(!rec.inspected){try{await inspectRecord(rec);}catch(error){setScanLog(`${bank.name} #${index}: ${error.message}`,true);}}
    if(index%10===0||index===end){$("#bankIndexProgress").textContent=`${index-start+1} / ${total}`; renderFsbStreams(bank.relativePath); await new Promise(r=>setTimeout(r,0));}
  }
  matchDefinitionCount();updateScanUi();renderSoundList();renderFsbStreams(bank.relativePath);setScanLog(`Indexed names for ${bank.name}.`);
}
function matchDefinitionCount(){let n=0;for(const id of state.sounds)if(resolveAudioFile(id))n++;state.scanStats.matched=n;return n;}
async function deepScanAssets(inputFiles,remember=false){
  if(activeScan)return setStatus("A scan is already running. Cancel it before starting another."); activeScan=true;scanCancelled=false;
  const seed=[...inputFiles]; $("#scanLog").replaceChildren(); setScanLog(`${seed.length.toLocaleString()} selected file entries received.`); $("#scanProgressBar").style.width="8%";
  try{
    let files=await expandArchivesRecursively(seed); files=[...new Map(files.map(f=>[`${relativePathOf(f)}:${f.size}`,f])).values()];
    state.scanStats={files:files.length,depth:files.reduce((m,f)=>Math.max(m,pathDepth(relativePathOf(f))),0),directAudio:0,fsbBanks:state.fsbBanks.size,fsbStreams:0,definitions:0,matched:0};updateScanUi();$("#scanProgressBar").style.width="22%";
    for(const file of files.filter(f=>/(^|\/)sound_definitions\.json$/i.test(relativePathOf(f))))if(!scanCancelled)await importDefinition(file);
    renderCategories();renderSoundList();
    const direct=files.filter(f=>AUDIO_EXTENSIONS.test(f.name)); if(direct.length){indexAudioFiles(direct,remember);state.scanStats.directAudio=direct.length;}
    const banks=files.filter(f=>FSB_EXTENSIONS.test(f.name)); setScanLog(`Found ${banks.length} FSB bank(s), ${direct.length} direct audio file(s), and ${state.scanStats.definitions} sound definitions.`);$("#scanProgressBar").style.width="38%";
    if(banks.length){await loadVgmstream();$("#decoderStatus").textContent="Decoder ready · lazy bank indexing enabled";}
    for(let i=0;i<banks.length&&!scanCancelled;i++){try{await probeBank(banks[i]);}catch(error){setScanLog(`FSB skipped: ${relativePathOf(banks[i])} — ${error.message}`,true);}$("#scanProgressBar").style.width=`${38+Math.round((i+1)/Math.max(1,banks.length)*55)}%`;}
    matchDefinitionCount();updateScanUi();renderFsbStreams();renderSoundList();updateAudioStatus();$("#scanProgressBar").style.width="100%";
    $("#audioDialogStatus").textContent=`Scanned ${files.length.toLocaleString()} files through ${state.scanStats.depth} folder levels. ${banks.length} FSB bank(s) are ready; stream names load lazily.`;
    setStatus(`Asset scan complete: ${banks.length} FSB banks and ${direct.length} direct audio files.`);
  }catch(error){setScanLog(`Scan failed: ${error.message}`,true);setStatus(`Asset scan failed: ${error.message}`);}finally{activeScan=false;$("#cancelScanBtn").classList.add("hidden");}
}
function stopDeepScan(){scanCancelled=true;activeScan=false;resetVgmstream();$("#cancelScanBtn")?.classList.add("hidden");setStatus("Asset scan cancelled.");}
function renderFsbBanks(){
  const host=$("#fsbBankList");if(!host)return;host.replaceChildren();const banks=[...state.fsbBanks.values()];
  if(!banks.length){host.innerHTML='<div class="empty-state"><strong>No FSB banks loaded</strong><span>Select the full Bedrock Samples folder, an FSB file, or a ZIP/mcpack/mcaddon.</span></div>';return;}
  for(const bank of banks){const b=document.createElement("button");b.className="bank-row"+(bank.relativePath===selectedFsbBankPath?" selected":"");b.innerHTML=`<span class="bank-icon">FSB</span><span><strong>${escapeHtml(bank.name)}</strong><small>${escapeHtml(bank.relativePath)}</small></span><b>${bank.streamCount.toLocaleString()}</b>`;b.onclick=()=>{selectedFsbBankPath=bank.relativePath;renderFsbBanks();renderFsbStreams(bank.relativePath);};host.append(b);}
}
function renderFsbStreams(bankPath=selectedFsbBankPath){
  const host=$("#fsbStreamList");if(!host)return;host.replaceChildren();const bank=state.fsbBanks.get(bankPath);
  if(!bank){host.innerHTML='<div class="empty-state"><strong>Select an FSB bank</strong><span>Streams are created instantly and decoded only when requested.</span></div>';return;}
  const query=($("#fsbStreamSearch")?.value||"").trim().toLowerCase(); let indices=[];
  if(query){for(let i=1;i<=bank.streamCount;i++){const r=recordForStream(bank,i);if(`${r.name} ${i}`.toLowerCase().includes(query))indices.push(i);if(indices.length>=500)break;}}
  else{const page=Number($("#fsbPageInput")?.value||1),start=(page-1)*100+1,end=Math.min(bank.streamCount,start+99);for(let i=start;i<=end;i++)indices.push(i);$("#fsbPageInput").max=String(Math.ceil(bank.streamCount/100));}
  for(const index of indices){const record=recordForStream(bank,index);const row=document.createElement("div");row.className="stream-row"+(selectedFsbRecord?.cacheKey===record.cacheKey?" selected":"");row.onclick=()=>{selectedFsbRecord=record;renderFsbStreams(bankPath);};const detail=[record.encoding,record.sampleRate?`${record.sampleRate} Hz`:"",record.durationSeconds?`${record.durationSeconds.toFixed(2)}s`:""].filter(Boolean).join(" · ")||"Metadata not indexed yet";row.innerHTML=`<button class="stream-preview">▶</button><span><strong>${escapeHtml(record.name)}</strong><small>#${index} · ${escapeHtml(detail)}</small></span><button class="stream-inspect">INFO</button><button class="stream-map">MAP</button>`;
    row.querySelector(".stream-inspect").onclick=async()=>{setStatus(`Reading ${bank.name} stream #${index}…`);try{await inspectRecord(record);renderFsbStreams(bankPath);}catch(e){setStatus(e.message);}};
    row.querySelector(".stream-preview").onclick=async()=>{setStatus(`Decoding ${bank.name} stream #${index}…`);try{await inspectRecord(record);const buffer=await decodeAudioRecord(record);if(!buffer)throw new Error("Audio decode failed");const source=getAudioContext().createBufferSource();source.buffer=buffer;connectChannelFx(source,state.channels[state.selectedChannel]||defaultChannels()[0],getAudioContext().currentTime,buffer.duration,.9);source.start();setStatus(`Playing ${record.name}.`);}catch(e){setStatus(`FSB preview failed: ${e.message}`);}};
    row.querySelector(".stream-map").onclick=async()=>{try{await inspectRecord(record);state.manualAudioMappings.set(state.selectedSound,record.cacheKey);matchDefinitionCount();updateScanUi();renderSoundList();setStatus(`Mapped ${state.selectedSound} to ${record.name}.`);}catch(e){setStatus(e.message);}};host.append(row);}
}
async function chooseDeepDirectory(){
  if(window.showDirectoryPicker){try{const h=await window.showDirectoryPicker({mode:"read"});const files=await walkHandle(h);await deepScanAssets(files,$("#rememberAudioInput").checked);return;}catch(e){if(e.name!=="AbortError")setStatus(`Folder picker failed: ${e.message}`);}}
  $("#audioFolderInput").click();
}
function bindFsbUi(){
  $("#deepFolderBtn")?.addEventListener("click",chooseDeepDirectory);$("#cancelScanBtn")?.addEventListener("click",stopDeepScan);
  $("#decoderBaseInput")?.addEventListener("change",e=>{localStorage.setItem("ms-vgmstream-base",e.target.value.trim());resetVgmstream();});
  $("#testDecoderBtn")?.addEventListener("click",async()=>{try{$("#decoderStatus").textContent="Loading decoder…";await loadVgmstream();$("#decoderStatus").textContent="vgmstream WebAssembly ready";}catch(e){$("#decoderStatus").textContent=`Decoder error: ${e.message}`;}});
  $("#fsbStreamSearch")?.addEventListener("input",()=>renderFsbStreams());$("#fsbPageInput")?.addEventListener("change",()=>renderFsbStreams());
  $("#indexPageBtn")?.addEventListener("click",()=>{const bank=state.fsbBanks.get(selectedFsbBankPath);if(!bank)return;const page=Number($("#fsbPageInput").value||1),start=(page-1)*100+1,end=Math.min(bank.streamCount,start+99);indexBankRange(bank,start,end);});
  $("#indexAllBtn")?.addEventListener("click",()=>{const bank=state.fsbBanks.get(selectedFsbBankPath);if(bank)indexBankRange(bank,1,bank.streamCount);});
}
