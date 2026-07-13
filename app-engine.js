function patternEvents(pattern, offsetStep = 0) {
  const events = [];
  const stepsByChannel = pattern.id === state.activePatternId ? state.channels.map((channel) => channel.steps) : pattern.channelSteps;
  const notes = pattern.id === state.activePatternId ? state.pianoNotes : pattern.pianoNotes;
  state.channels.forEach((channel, channelIndex) => {
    for (const step of stepsByChannel[channelIndex] || []) events.push({ step: offsetStep + step, channel: channelIndex, midi: 60, velocity: 1, source: "rack" });
  });
  for (const note of notes || []) if (state.channels[note.channel]) events.push({ step: offsetStep + note.step, channel: note.channel, midi: note.midi, velocity: note.velocity ?? 0.8, source: "piano" });
  return events;
}

function playbackTimeline() {
  saveActivePattern();
  if (state.playbackMode === "song" && state.playlistClips.length) {
    const events = [];
    for (const clip of state.playlistClips) {
      const pattern = state.patterns.find((item) => item.id === clip.patternId);
      if (pattern) events.push(...patternEvents(pattern, clip.startStep));
    }
    const length = Math.max(state.steps, ...state.playlistClips.map((clip) => clip.startStep + clip.lengthSteps));
    return { events, length };
  }
  return { events: patternEvents(activePattern(), 0), length: state.steps };
}

async function preparePlaybackAssets() {
  const sounds = [...new Set(state.channels.filter(channelIsAudible).map((channel) => channel.sound))];
  await Promise.all(sounds.map((sound) => prepareSound(sound)));
}

function scheduleStep(step, when, events) {
  const context = getAudioContext();
  const swingDelay = step % 2 === 1 ? ((60000 / state.bpm) / 1000 / 4) * (state.swing / 100) * 0.5 : 0;
  const playAt = when + swingDelay;
  events.filter((event) => event.step === step).forEach((event) => {
    const channel = state.channels[event.channel];
    if (channel) playSound(channel.sound, channel, event.midi, playAt, event.velocity, 0.2);
  });
  if (state.metronome && step % 4 === 0) {
    const clickChannel = { volume: 0.3, pitch: step % 16 === 0 ? 1.4 : 1, pan: 0, filter: 18000, delay: 0, mute: false, solo: false };
    synthFallback("metronome.click", clickChannel, step % 16 === 0 ? 84 : 78, playAt, 0.5, 0.05);
  }
  const delayMs = Math.max(0, (playAt - context.currentTime) * 1000);
  setTimeout(() => updatePlayhead(step), delayMs);
}

function scheduler() {
  if (!state.playing) return;
  const context = getAudioContext();
  const { events, length } = playbackTimeline();
  const secondsPerStep = (60 / state.bpm) / 4;
  while (nextStepTime < context.currentTime + 0.12) {
    if (schedulerStep >= length) {
      if (state.loop) schedulerStep = 0;
      else return stopPlayback();
    }
    scheduleStep(schedulerStep, nextStepTime, events);
    nextStepTime += secondsPerStep;
    schedulerStep++;
  }
}

async function startPlayback() {
  if (state.playing) return pausePlayback();
  state.bpm = clamp(Number($("#bpmInput").value) || 120, 40, 300);
  state.playing = true;
  $("#playBtn").textContent = "Ⅱ";
  setStatus("Preparing preview audio…");
  await preparePlaybackAssets();
  const context = getAudioContext();
  nextStepTime = context.currentTime + 0.06;
  schedulerStep = state.currentStep || 0;
  schedulerTimer = window.setInterval(scheduler, 25);
  scheduler();
  setStatus(state.audioIndex.size ? "Playback started with loaded Minecraft audio where available." : "Playback started with synthesized fallback audio. Use AUDIO to load real Minecraft sounds.");
}

function pausePlayback() {
  state.playing = false;
  clearInterval(schedulerTimer);
  $("#playBtn").textContent = "▶";
  setStatus("Playback paused.");
}

function stopPlayback(showStatus = true) {
  state.playing = false;
  state.currentStep = 0;
  clearInterval(schedulerTimer);
  $$(".step.playing").forEach((element) => element.classList.remove("playing"));
  $("#playBtn").textContent = "▶";
  $("#positionText").textContent = "001:01:000";
  if (showStatus) setStatus("Playback stopped.");
}

function updatePlayhead(step) {
  state.currentStep = step;
  $$(".step.playing").forEach((element) => element.classList.remove("playing"));
  $$(`.step[data-step="${step % state.steps}"]`).forEach((element) => element.classList.add("playing"));
  const bar = Math.floor(step / 16) + 1;
  const beat = Math.floor((step % 16) / 4) + 1;
  const tick = (step % 4) * 240;
  $("#positionText").textContent = `${String(bar).padStart(3, "0")}:${String(beat).padStart(2, "0")}:${String(tick).padStart(3, "0")}`;
}

function setPlaybackMode(mode, rerender = true) {
  state.playbackMode = mode === "song" ? "song" : "pattern";
  $("#patternModeBtn").classList.toggle("active", state.playbackMode === "pattern");
  $("#songModeBtn").classList.toggle("active", state.playbackMode === "song");
  $("#modeText").textContent = state.playbackMode === "song" ? "SONG" : (activePattern()?.name || "PATTERN").toUpperCase();
  if (rerender) { updateProjectStats(); scheduleAutosave(); }
}

function createSongObject(mode = $("#exportModeSelect")?.value || state.playbackMode) {
  saveActivePattern();
  const title = ($("#titleInput").value || "Untitled Song").trim().slice(0, 48);
  const author = ($("#authorInput")?.value || "Player").trim().slice(0, 32);
  const extraTags = ($("#tagsInput")?.value || "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const tags = [...new Set([...REQUIRED_TAGS, ...extraTags])].filter((tag) => /^[a-z0-9_.:-]{1,64}$/.test(tag));
  const arrangement = mode === "song" && state.playlistClips.length;
  const eventSteps = [];
  if (arrangement) {
    for (const clip of state.playlistClips) {
      const pattern = state.patterns.find((item) => item.id === clip.patternId);
      if (pattern) eventSteps.push(...patternEvents(pattern, clip.startStep));
    }
  } else eventSteps.push(...patternEvents(activePattern(), 0));
  const events = eventSteps.map((event) => {
    const channel = state.channels[event.channel];
    return {
      beat: Number((event.step / 4).toFixed(4)),
      sound: channel.sound,
      pitch: Number(((channel.pitch || 1) * pitchFromMidi(event.midi)).toFixed(4)),
      volume: Number(((channel.volume || 0.75) * (event.velocity || 1) * state.master).toFixed(4)),
      channel: event.channel,
      pan: Number((channel.pan || 0).toFixed(3))
    };
  }).sort((a, b) => a.beat - b.beat || a.channel - b.channel);
  const computedLength = arrangement ? Math.max(state.steps / 4, ...state.playlistClips.map((clip) => (clip.startStep + clip.lengthSteps) / 4)) : state.steps / 4;
  const requestedLength = clamp(Number($("#lengthInput")?.value) || computedLength, 1, 4096);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "song";
  return {
    schema: "ms:song@1",
    id: `ms_${slug}_${Date.now().toString(36)}`,
    title,
    author,
    authorId: "web",
    bpm: state.bpm,
    lengthBeats: Math.max(computedLength, requestedLength),
    loop: state.loop,
    public: false,
    tags,
    events
  };
}

function downloadBlob(name, content, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadSong() {
  const song = createSongObject();
  downloadBlob(`${song.title.replace(/[^a-z0-9_-]+/gi, "_") || "song"}.mssong`, JSON.stringify(song, null, 2) + "\n");
  setStatus(`Exported ${song.title} with ${song.events.length} events.`);
}

async function copyCompactJson() {
  const text = JSON.stringify(createSongObject());
  try { await navigator.clipboard.writeText(text); setStatus("Compact song JSON copied. Paste it into the Bedrock add-on import screen."); }
  catch { prompt("Copy the compact song JSON:", text); }
}

function saveProjectFile() {
  state.title = $("#titleInput").value.trim() || "Untitled Song";
  const project = snapshotCore();
  project.schema = "ms:project@2";
  downloadBlob(`${state.title.replace(/[^a-z0-9_-]+/gi, "_") || "project"}.msproject`, JSON.stringify(project, null, 2) + "\n");
  setStatus("Project saved.");
}

function importProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (data.schema === "ms:song@1") return importSongObject(data);
      pushHistory();
      restoreCore(data);
      setStatus(`Loaded project: ${data.title || file.name}`);
    } catch (error) { setStatus(`Project import failed: ${error}`); }
  };
  reader.readAsText(file);
}

function importSongObject(song) {
  if (!song || !Array.isArray(song.events)) throw new Error("Invalid .mssong file");
  pushHistory();
  const soundIds = [...new Set(song.events.map((event) => event.sound).filter(Boolean))];
  state.channels = soundIds.map((sound, index) => ({ id: uid("ch"), name: sound.split(".").slice(-2).join(" ").replace(/_/g, " "), sound, volume: 0.75, pitch: 1, pan: 0, filter: 20000, delay: 0, mute: false, solo: false, steps: [] }));
  const lengthBeats = clamp(Number(song.lengthBeats || 4), 1, 32);
  state.steps = [16, 32, 64, 128].find((steps) => steps >= lengthBeats * 4) || 128;
  const channelSteps = state.channels.map(() => []);
  const pianoNotes = [];
  song.events.forEach((event) => {
    const channel = Math.max(0, soundIds.indexOf(event.sound));
    const step = clamp(Math.round(Number(event.beat || 0) * 4), 0, state.steps - 1);
    if (Math.abs(Number(event.pitch || 1) - 1) < 0.02) channelSteps[channel].push(step);
    else pianoNotes.push({ channel, step, midi: clamp(Math.round(60 + 12 * Math.log2(Number(event.pitch || 1))), 36, 84), length: 1, velocity: clamp(Number(event.volume || 0.8), 0.05, 1) });
  });
  const pattern = { id: uid("pat"), name: "Imported Song", channelSteps: channelSteps.map((steps) => [...new Set(steps)]), pianoNotes };
  state.patterns = [pattern]; state.activePatternId = pattern.id; state.pianoNotes = copy(pianoNotes);
  state.channels.forEach((channel, index) => channel.steps = [...pattern.channelSteps[index]]);
  state.playlistClips = [];
  state.title = song.title || "Imported Song"; state.bpm = clamp(Number(song.bpm || 120), 40, 300); state.loop = Boolean(song.loop);
  syncUiFromState(); renderAll(); setStatus(`Imported ${song.title || "song"} with ${song.events.length} events.`);
}

function newProject() {
  if (!confirm("Create a new project? Unsaved changes will be replaced.")) return;
  pushHistory();
  const preserved = { sounds: state.sounds, soundDefinitions: state.soundDefinitions, audioIndex: state.audioIndex, audioBuffers: state.audioBuffers, favourites: state.favourites, history: state.history, future: [] };
  state = Object.assign(makeDefaultState(), preserved);
  syncUiFromState(); renderAll(); setStatus("New project created.");
}

function addPattern(duplicate = false) {
  pushHistory();
  saveActivePattern();
  const source = activePattern();
  const pattern = {
    id: uid("pat"), name: duplicate ? `${source.name} Copy` : `Pattern ${state.patterns.length + 1}`,
    channelSteps: duplicate ? copy(source.channelSteps) : state.channels.map(() => []),
    pianoNotes: duplicate ? copy(source.pianoNotes) : []
  };
  state.patterns.push(pattern);
  loadPattern(pattern.id);
}

function deletePattern() {
  if (state.patterns.length <= 1) return setStatus("A project must keep at least one pattern.");
  pushHistory();
  const removed = activePattern();
  state.patterns.splice(state.patterns.indexOf(removed), 1);
  state.playlistClips = state.playlistClips.filter((clip) => clip.patternId !== removed.id);
  loadPattern(state.patterns[0].id);
}

function randomizeSelectedChannel() {
  const channel = state.channels[state.selectedChannel];
  if (!channel) return;
  pushHistory();
  channel.steps = [];
  const density = soundCategory(channel.sound) === "note" ? 0.27 : 0.18;
  for (let step = 0; step < state.steps; step++) if (Math.random() < density) channel.steps.push(step);
  saveActivePattern(); renderAll(); setStatus(`Randomized ${channel.name}.`);
}

function rotateSelectedChannel(direction) {
  const channel = state.channels[state.selectedChannel];
  if (!channel) return;
  pushHistory();
  channel.steps = channel.steps.map((step) => (step + direction + state.steps) % state.steps).sort((a, b) => a - b);
  saveActivePattern(); renderAll();
}

function clearCurrentPattern() {
  pushHistory();
  state.channels.forEach((channel) => channel.steps = []);
  state.pianoNotes = [];
  saveActivePattern(); renderAll();
}

function resetMixer() {
  pushHistory();
  state.channels.forEach((channel) => Object.assign(channel, { volume: 0.75, pitch: 1, pan: 0, filter: 20000, delay: 0, mute: false, solo: false }));
  state.master = 0.85; $("#masterInput").value = state.master; $("#masterValue").value = "85%";
  if (masterGain) masterGain.gain.value = state.master;
  renderAll();
}

function updateProjectStats() {
  saveActivePattern();
  const song = createSongObject(state.playbackMode);
  $("#eventCount").textContent = `${song.events.length} events • ${state.channels.length} channels`;
  $("#patternCount").textContent = state.patterns.length;
  $("#clipCount").textContent = state.playlistClips.length;
  $("#eventStat").textContent = song.events.length;
  $("#audioCount").textContent = uniqueAudioRecords().length.toLocaleString();
  $("#modeText").textContent = state.playbackMode === "song" ? "SONG" : (activePattern()?.name || "PATTERN").toUpperCase();
  scheduleAutosave();
}

