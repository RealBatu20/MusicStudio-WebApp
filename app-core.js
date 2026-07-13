const FALLBACK_SOUNDS = window.MS_FALLBACK_SOUNDS || [];
const OFFICIAL_CATALOG_URL = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/sounds/sound_definitions.json";
const REQUIRED_TAGS = ["ms:is_music", "ms:is_song"];
const COLORS = ["#f0a12a", "#75c96c", "#65b7d2", "#da6a99", "#b895e7", "#e1d263", "#e46c57", "#66c0a9", "#e78bb4", "#8ab6f0"];
const AUDIO_EXTENSIONS = /\.(ogg|wav|mp3|m4a|aac|flac)$/i;
const PROJECT_KEY = "ms-studio-project-v2";
const FAVOURITES_KEY = "ms-studio-favourites-v2";
const DB_NAME = "ms-studio-audio-v1";
const DB_STORE = "files";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const copy = (value) => JSON.parse(JSON.stringify(value));
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const defaultChannels = () => [
  { id: uid("ch"), name: "Kick", sound: "note.bd", volume: 0.86, pitch: 1, pan: 0, filter: 20000, delay: 0, mute: false, solo: false },
  { id: uid("ch"), name: "Hat", sound: "note.hat", volume: 0.58, pitch: 1.15, pan: 0.12, filter: 17000, delay: 0, mute: false, solo: false },
  { id: uid("ch"), name: "Snare", sound: "note.snare", volume: 0.72, pitch: 1, pan: -0.08, filter: 19000, delay: 0.03, mute: false, solo: false },
  { id: uid("ch"), name: "Harp", sound: "note.harp", volume: 0.76, pitch: 1, pan: 0, filter: 15000, delay: 0.08, mute: false, solo: false }
];

function makeDefaultState() {
  const channels = defaultChannels();
  const pattern = {
    id: uid("pat"),
    name: "Pattern 1",
    channelSteps: [[0, 4, 8, 12], [2, 6, 10, 14], [4, 12], [0, 3, 7, 10, 14]],
    pianoNotes: [
      { channel: 3, step: 0, midi: 60, length: 2, velocity: 0.8 },
      { channel: 3, step: 3, midi: 64, length: 2, velocity: 0.8 },
      { channel: 3, step: 7, midi: 67, length: 2, velocity: 0.8 },
      { channel: 3, step: 10, midi: 72, length: 2, velocity: 0.8 },
      { channel: 3, step: 14, midi: 67, length: 2, velocity: 0.8 }
    ]
  };
  channels.forEach((channel, index) => { channel.steps = [...pattern.channelSteps[index]]; });
  return {
    version: 2,
    title: "Untitled Song",
    bpm: 120,
    swing: 0,
    master: 0.85,
    loop: true,
    metronome: false,
    playbackMode: "pattern",
    sounds: [...FALLBACK_SOUNDS],
    soundDefinitions: {},
    selectedSound: "note.harp",
    selectedChannel: 0,
    steps: 16,
    channels,
    pianoNotes: copy(pattern.pianoNotes),
    patterns: [pattern],
    activePatternId: pattern.id,
    playlistBars: 16,
    playlistTracks: 8,
    playlistClips: [],
    selectedClipId: null,
    playing: false,
    currentStep: 0,
    recordArmed: false,
    favourites: new Set(JSON.parse(localStorage.getItem(FAVOURITES_KEY) || "[]")),
    audioIndex: new Map(),
    audioBuffers: new Map(),
    history: [],
    future: []
  };
}

let state = makeDefaultState();
let audioContext;
let masterGain;
let noiseBuffer;
let schedulerTimer = 0;
let nextStepTime = 0;
let schedulerStep = 0;
let deferredInstallPrompt = null;
let tapTimes = [];
let activeMobileView = "rack";
let saveTimer = 0;
let paintSession = null;
let dragSession = null;

function setStatus(text) {
  $("#statusText").textContent = text;
}

function normalizePath(path) {
  const cleaned = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
  return cleaned.replace(AUDIO_EXTENSIONS, "");
}

function soundCategory(id) {
  return String(id).split(".")[0] || "other";
}

function sortSounds(list) {
  return [...new Set(list.filter((id) => typeof id === "string" && /^[a-z0-9_.:-]+$/.test(id)))].sort((a, b) => a.localeCompare(b));
}

function activePattern() {
  return state.patterns.find((pattern) => pattern.id === state.activePatternId) || state.patterns[0];
}

function saveActivePattern() {
  const pattern = activePattern();
  if (!pattern) return;
  pattern.channelSteps = state.channels.map((channel) => [...channel.steps]);
  pattern.pianoNotes = copy(state.pianoNotes);
}

function loadPattern(patternId) {
  saveActivePattern();
  const pattern = state.patterns.find((item) => item.id === patternId);
  if (!pattern) return;
  state.activePatternId = pattern.id;
  state.channels.forEach((channel, index) => { channel.steps = [...(pattern.channelSteps[index] || [])].filter((step) => step < state.steps); });
  state.pianoNotes = copy(pattern.pianoNotes || []).filter((note) => note.step < state.steps && note.channel < state.channels.length);
  renderAll();
  setStatus(`Selected ${pattern.name}.`);
}

function snapshotCore() {
  saveActivePattern();
  return copy({
    version: 2,
    title: state.title,
    bpm: state.bpm,
    swing: state.swing,
    master: state.master,
    loop: state.loop,
    metronome: state.metronome,
    playbackMode: state.playbackMode,
    selectedSound: state.selectedSound,
    selectedChannel: state.selectedChannel,
    steps: state.steps,
    channels: state.channels,
    pianoNotes: state.pianoNotes,
    patterns: state.patterns,
    activePatternId: state.activePatternId,
    playlistBars: state.playlistBars,
    playlistTracks: state.playlistTracks,
    playlistClips: state.playlistClips,
    selectedClipId: state.selectedClipId
  });
}

function restoreCore(data) {
  stopPlayback(false);
  const preserved = {
    sounds: state.sounds,
    soundDefinitions: state.soundDefinitions,
    audioIndex: state.audioIndex,
    audioBuffers: state.audioBuffers,
    favourites: state.favourites,
    history: state.history,
    future: state.future
  };
  state = Object.assign(makeDefaultState(), data, preserved);
  state.channels = (data.channels || []).map((channel) => ({
    id: channel.id || uid("ch"), name: channel.name || "Channel", sound: channel.sound || "note.harp",
    volume: clamp(Number(channel.volume ?? 0.75), 0, 2), pitch: clamp(Number(channel.pitch ?? 1), 0.1, 4),
    pan: clamp(Number(channel.pan ?? 0), -1, 1), filter: clamp(Number(channel.filter ?? 20000), 100, 20000),
    delay: clamp(Number(channel.delay ?? 0), 0, 0.75), mute: Boolean(channel.mute), solo: Boolean(channel.solo),
    steps: [...(channel.steps || [])]
  }));
  state.patterns = (data.patterns || []).map((pattern, index) => ({
    id: pattern.id || uid("pat"), name: pattern.name || `Pattern ${index + 1}`,
    channelSteps: copy(pattern.channelSteps || state.channels.map((channel) => channel.steps || [])),
    pianoNotes: copy(pattern.pianoNotes || [])
  }));
  if (!state.patterns.length) state.patterns.push({ id: uid("pat"), name: "Pattern 1", channelSteps: state.channels.map(() => []), pianoNotes: [] });
  if (!state.patterns.some((pattern) => pattern.id === state.activePatternId)) state.activePatternId = state.patterns[0].id;
  state.playlistClips = data.playlistClips || [];
  state.pianoNotes = data.pianoNotes || [];
  loadPattern(state.activePatternId);
  syncUiFromState();
  renderAll();
}

function pushHistory() {
  const next = snapshotCore();
  const last = state.history[state.history.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(next)) return;
  state.history.push(next);
  if (state.history.length > 60) state.history.shift();
  state.future.length = 0;
}

function undo() {
  if (!state.history.length) return setStatus("Nothing to undo.");
  const current = snapshotCore();
  const previous = state.history.pop();
  state.future.push(current);
  const history = state.history;
  const future = state.future;
  restoreCore(previous);
  state.history = history;
  state.future = future;
  setStatus("Undo.");
}

function redo() {
  if (!state.future.length) return setStatus("Nothing to redo.");
  const current = snapshotCore();
  const next = state.future.pop();
  state.history.push(current);
  const history = state.history;
  const future = state.future;
  restoreCore(next);
  state.history = history;
  state.future = future;
  setStatus("Redo.");
}

function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(PROJECT_KEY, JSON.stringify(snapshotCore())); } catch (error) { console.warn("Autosave failed", error); }
  }, 350);
}

function syncUiFromState() {
  $("#titleInput").value = state.title;
  $("#bpmInput").value = state.bpm;
  $("#swingInput").value = state.swing;
  $("#swingValue").value = `${state.swing}%`;
  $("#masterInput").value = state.master;
  $("#masterValue").value = `${Math.round(state.master * 100)}%`;
  $("#loopInput").checked = state.loop;
  $("#metronomeInput").checked = state.metronome;
  $("#stepsSelect").value = String(state.steps);
  $("#playlistBars").value = String(state.playlistBars);
  setPlaybackMode(state.playbackMode, false);
}

