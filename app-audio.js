function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = state.master;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function getNoiseBuffer() {
  const context = getAudioContext();
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
  noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function channelIsAudible(channel) {
  const hasSolo = state.channels.some((item) => item.solo);
  return !channel.mute && (!hasSolo || channel.solo);
}

function connectChannelFx(source, channel, time, duration, velocity = 1) {
  const context = getAudioContext();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(clamp(channel.filter || 20000, 100, 20000), time);
  const gain = context.createGain();
  gain.gain.setValueAtTime(clamp((channel.volume || 0.75) * velocity, 0.0001, 2), time);
  const pan = context.createStereoPanner ? context.createStereoPanner() : null;
  if (pan) pan.pan.setValueAtTime(clamp(channel.pan || 0, -1, 1), time);
  source.connect(filter);
  filter.connect(gain);
  if (pan) { gain.connect(pan); pan.connect(masterGain); } else gain.connect(masterGain);
  if ((channel.delay || 0) > 0.001) {
    const delay = context.createDelay(1);
    const feedback = context.createGain();
    const wet = context.createGain();
    delay.delayTime.setValueAtTime(clamp(channel.delay, 0, 0.75), time);
    feedback.gain.value = 0.25;
    wet.gain.value = 0.32;
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    if (pan) wet.connect(pan); else wet.connect(masterGain);
    setTimeout(() => { try { delay.disconnect(); feedback.disconnect(); wet.disconnect(); } catch {} }, Math.max(1000, duration * 1000 + 2500));
  }
  return { filter, gain, pan };
}

function definitionChoices(soundId) {
  const definition = state.soundDefinitions[soundId];
  if (!definition || !Array.isArray(definition.sounds)) return [];
  return definition.sounds.map((entry) => typeof entry === "string" ? { name: entry } : entry).filter((entry) => entry && entry.name);
}

function audioCandidates(soundId) {
  const choices = definitionChoices(soundId);
  if (!choices.length) return [];
  const shuffled = [...choices].sort(() => Math.random() - 0.5);
  const result = [];
  for (const entry of shuffled) {
    const original = normalizePath(entry.name);
    const soundsIndex = original.indexOf("sounds/");
    const fromSounds = soundsIndex >= 0 ? original.slice(soundsIndex) : `sounds/${original}`;
    const basename = original.split("/").pop();
    result.push({ key: original, entry }, { key: fromSounds, entry }, { key: basename, entry });
  }
  return result;
}

function resolveAudioFile(soundId) {
  const mappedKey = state.manualAudioMappings?.get(soundId);
  if (mappedKey) {
    const mapped = state.fsbStreams?.get(mappedKey) || [...state.audioIndex.values()].find((record) => (record.cacheKey || record.path) === mappedKey);
    if (mapped) return mapped;
  }
  for (const candidate of audioCandidates(soundId)) {
    const record = state.audioIndex.get(candidate.key);
    if (record) return { ...record, definitionEntry: candidate.entry };
  }
  const direct = normalizePath(soundId);
  return state.audioIndex.get(direct) || state.audioIndex.get(direct.split(".").join("/")) || null;
}

async function decodeAudioRecord(record) {
  if (!record) return null;
  const cacheKey = record.cacheKey || record.path;
  if (state.audioBuffers.has(cacheKey)) return state.audioBuffers.get(cacheKey);
  const promise = (async () => {
    try {
      const bytes = record.kind === "fsb" ? await decodeFsbRecord(record) : await record.blob.arrayBuffer();
      const buffer = await getAudioContext().decodeAudioData(bytes.slice ? bytes.slice(0) : bytes);
      return buffer;
    } catch (error) {
      console.warn(`Could not decode ${record.path || record.name}`, error);
      return null;
    }
  })();
  state.audioBuffers.set(cacheKey, promise);
  const decoded = await promise;
  state.audioBuffers.set(cacheKey, decoded);
  return decoded;
}

async function prepareSound(soundId) {
  const record = resolveAudioFile(soundId);
  if (!record) return null;
  const buffer = await decodeAudioRecord(record);
  return buffer ? { record, buffer } : null;
}

async function playSound(soundId, channel, midi = 60, when = null, velocity = 1, duration = 0.18) {
  if (!channel || !channelIsAudible(channel)) return;
  const context = getAudioContext();
  const time = Math.max(context.currentTime, when ?? context.currentTime);
  const resolved = await prepareSound(soundId);
  if (resolved) {
    const source = context.createBufferSource();
    source.buffer = resolved.buffer;
    const entryPitch = Number(resolved.record.definitionEntry?.pitch || 1);
    const midiPitch = Math.pow(2, (midi - 60) / 12);
    source.playbackRate.setValueAtTime(clamp((channel.pitch || 1) * midiPitch * entryPitch, 0.1, 4), time);
    connectChannelFx(source, channel, time, resolved.buffer.duration, velocity * Number(resolved.record.definitionEntry?.volume || 1));
    source.start(time);
    return;
  }
  synthFallback(soundId, channel, midi, time, velocity, duration);
}

function synthFallback(soundId, channel, midi, time, velocity = 1, duration = 0.16) {
  const context = getAudioContext();
  const id = String(soundId).toLowerCase();
  const baseFrequency = 440 * Math.pow(2, (midi - 69) / 12) * (channel.pitch || 1);
  if (/bd|kick|explode|thunder/.test(id)) {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.max(55, baseFrequency * 0.55), time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.14);
    const fx = connectChannelFx(osc, channel, time, 0.18, velocity * 0.7);
    fx.gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.start(time); osc.stop(time + 0.2);
    return;
  }
  if (/hat|snare|break|hit|step|click/.test(id)) {
    const source = context.createBufferSource();
    source.buffer = getNoiseBuffer();
    const filter = context.createBiquadFilter();
    filter.type = /hat/.test(id) ? "highpass" : "bandpass";
    filter.frequency.value = /hat/.test(id) ? 7000 : 1800;
    source.connect(filter);
    const fx = connectChannelFx(filter, channel, time, 0.12, velocity * 0.35);
    fx.gain.gain.exponentialRampToValueAtTime(0.001, time + (/hat/.test(id) ? 0.06 : 0.14));
    source.start(time); source.stop(time + 0.16);
    return;
  }
  const types = /ambient|music|record/.test(id) ? ["sine", "triangle", "sine"] : [/entity|mob|hurt|growl/.test(id) ? "sawtooth" : "triangle"];
  types.forEach((type, index) => {
    const osc = context.createOscillator();
    osc.type = type;
    const ratio = types.length > 1 ? [1, 1.25, 1.5][index] : 1;
    osc.frequency.setValueAtTime(baseFrequency * ratio, time);
    const fx = connectChannelFx(osc, channel, time, duration, velocity * (types.length > 1 ? 0.18 : 0.22));
    fx.gain.gain.setValueAtTime(Math.max(0.001, fx.gain.gain.value || 0.02), time);
    fx.gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.start(time); osc.stop(time + duration + 0.02);
  });
}

async function previewSound(soundId = state.selectedSound) {
  const channel = state.channels[state.selectedChannel] || { volume: 0.7, pitch: 1, pan: 0, filter: 20000, delay: 0, mute: false, solo: false };
  const hasReal = Boolean(resolveAudioFile(soundId));
  await playSound(soundId, { ...channel, mute: false, solo: false }, 60, null, 0.8, 0.22);
  setStatus(hasReal ? `Previewing Minecraft audio: ${soundId}` : `No matching audio file for ${soundId}; using the synthesized fallback.`);
}

function indexAudioFiles(files, remember = false) {
  const accepted = [...files].filter((file) => AUDIO_EXTENSIONS.test(file.name));
  if (!accepted.length) return setStatus("No supported audio files were selected.");
  let added = 0;
  const dbRecords = [];
  for (const file of accepted) {
    const relative = file.webkitRelativePath || file.relativePath || file.name;
    const full = normalizePath(relative);
    const soundsAt = full.indexOf("sounds/");
    const canonical = soundsAt >= 0 ? full.slice(soundsAt) : full;
    const record = { kind: "file", cacheKey: `file:${canonical}`, path: canonical, blob: file, name: file.name, type: file.type || "audio/ogg" };
    const aliases = new Set([canonical, full, canonical.replace(/^sounds\//, ""), canonical.split("/").pop()]);
    aliases.forEach((key) => state.audioIndex.set(key, record));
    dbRecords.push(record);
    added++;
  }
  state.audioBuffers.clear();
  updateAudioStatus();
  renderSoundList();
  setStatus(`Loaded ${added.toLocaleString()} local Minecraft audio files.`);
  $("#audioDialogStatus").textContent = `${added.toLocaleString()} files loaded for this session.`;
  if (remember) saveAudioRecords(dbRecords).then(() => setStatus(`${added.toLocaleString()} audio files loaded and saved in this browser.`)).catch((error) => setStatus(`Audio loaded, but browser storage failed: ${error}`));
}

function uniqueAudioRecords() {
  return [...new Map([...state.audioIndex.values()].map((record) => [record.cacheKey || record.path, record])).values()];
}

function updateAudioStatus() {
  const records = uniqueAudioRecords();
  const direct = records.filter((record) => record.kind !== "fsb").length;
  const fsb = records.filter((record) => record.kind === "fsb").length;
  const count = records.length;
  $("#audioStatus").textContent = count
    ? `${direct.toLocaleString()} files + ${fsb.toLocaleString()} FSB streams ready for real previews`
    : "No Minecraft audio assets loaded; synthesized preview is active";
  $("#audioCount").textContent = count.toLocaleString();
  $("#audioDialogStatus").textContent = count ? `${count.toLocaleString()} unique playable assets indexed.` : "No audio loaded.";
}

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "path" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAudioRecords(records) {
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  const db = await openAudioDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    const store = transaction.objectStore(DB_STORE);
    records.forEach((record) => store.put(record));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function loadStoredAudio() {
  if (!window.indexedDB) return;
  try {
    const db = await openAudioDb();
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    for (const record of records) {
      const aliases = new Set([record.path, record.path.replace(/^sounds\//, ""), record.path.split("/").pop()]);
      aliases.forEach((key) => state.audioIndex.set(key, record));
    }
    if (records.length) {
      updateAudioStatus();
      renderSoundList();
      setStatus(`Restored ${records.length.toLocaleString()} audio files from browser storage.`);
    }
  } catch (error) {
    console.warn("Stored audio could not be loaded", error);
  }
}

async function clearStoredAudio() {
  state.audioIndex.clear();
  state.audioBuffers.clear();
  state.fsbBanks?.clear();
  state.fsbStreams?.clear();
  state.manualAudioMappings?.clear();
  if (typeof selectedFsbBankPath !== "undefined") selectedFsbBankPath = null;
  state.scanStats = { files: 0, depth: 0, directAudio: 0, fsbBanks: 0, fsbStreams: 0, definitions: 0, matched: 0 };
  renderFsbBanks?.();
  renderFsbStreams?.();
  updateScanStatsUi?.();
  if (window.indexedDB) {
    try {
      const db = await openAudioDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, "readwrite");
        transaction.objectStore(DB_STORE).clear();
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    } catch (error) { console.warn(error); }
  }
  updateAudioStatus();
  renderSoundList();
  setStatus("Local audio cache cleared.");
}

async function syncOfficialCatalog() {
  const status = $("#catalogStatus");
  status.textContent = "Syncing official Mojang Bedrock sound definitions…";
  try {
    const response = await fetch(OFFICIAL_CATALOG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const definitions = data.sound_definitions || {};
    const ids = Object.keys(definitions);
    if (!ids.length) throw new Error("No sound definitions found");
    state.soundDefinitions = definitions;
    state.sounds = sortSounds(ids);
    status.textContent = `${state.sounds.length.toLocaleString()} official Bedrock sound IDs loaded`;
    renderCategories();
    renderSoundList();
    setStatus("Official sound definitions synced. Use AUDIO to load matching Minecraft audio files.");
  } catch (error) {
    state.sounds = sortSounds(FALLBACK_SOUNDS);
    status.textContent = `${state.sounds.length} fallback IDs loaded; import sound_definitions.json for the full list`;
    renderCategories();
    renderSoundList();
    setStatus(`Catalog sync failed: ${error}. Fallback sound IDs are active.`);
  }
}

function importCatalogFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const definitions = data.sound_definitions || {};
      const ids = Object.keys(definitions);
      if (!ids.length) throw new Error("No sound_definitions object found");
      state.soundDefinitions = definitions;
      state.sounds = sortSounds(ids);
      $("#catalogStatus").textContent = `${state.sounds.length.toLocaleString()} imported sound IDs loaded`;
      renderCategories();
      renderSoundList();
      setStatus("Imported sound definitions loaded.");
    } catch (error) { setStatus(`Sound-definition import failed: ${error}`); }
  };
  reader.readAsText(file);
}

