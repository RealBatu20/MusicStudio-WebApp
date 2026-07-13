import { FALLBACK_SOUNDS } from "./sound_catalog_fallback.js";

const OFFICIAL_CATALOG_URL =
  "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/sounds/sound_definitions.json";
const REQUIRED_TAGS = ["ms:is_music", "ms:is_song"];
const COLORS = ["#f0a12a","#75c96c","#65b7d2","#da6a99","#b895e7","#e1d263","#e46c57","#66c0a9"];

const state = {
  sounds: [...FALLBACK_SOUNDS],
  selectedSound: "note.harp",
  selectedChannel: 0,
  steps: 16,
  playing: false,
  playStart: 0,
  raf: 0,
  channels: [
    { name: "Kick", sound: "note.bd", volume: 0.85, pitch: 1, steps: [0,4,8,12] },
    { name: "Hat", sound: "note.hat", volume: 0.55, pitch: 1.2, steps: [2,6,10,14] },
    { name: "Snare", sound: "note.snare", volume: 0.7, pitch: 1, steps: [4,12] },
    { name: "Harp", sound: "note.harp", volume: 0.75, pitch: 1, steps: [0,3,7,10,14] }
  ],
  pianoNotes: [
    { channel: 3, step: 0, midi: 60, length: 2 },
    { channel: 3, step: 3, midi: 64, length: 2 },
    { channel: 3, step: 7, midi: 67, length: 2 },
    { channel: 3, step: 10, midi: 72, length: 2 },
    { channel: 3, step: 14, midi: 67, length: 2 }
  ]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setStatus(text) {
  $("#statusText").textContent = text;
}

function soundCategory(id) {
  return id.split(".")[0] || "other";
}

function sortSounds(list) {
  return [...new Set(list.filter((id) => typeof id === "string" && /^[a-z0-9_.:-]+$/.test(id)))]
    .sort((a, b) => a.localeCompare(b));
}

async function syncOfficialCatalog() {
  const status = $("#catalogStatus");
  status.textContent = "Syncing official Mojang Bedrock catalog…";
  try {
    const response = await fetch(OFFICIAL_CATALOG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const ids = Object.keys(data.sound_definitions || {});
    if (!ids.length) throw new Error("No sound definitions found");
    state.sounds = sortSounds(ids);
    status.textContent = `${state.sounds.length.toLocaleString()} official Bedrock sound IDs loaded`;
    renderSoundList();
    setStatus("Official sound catalog synced. Click a sound to assign it to the selected channel.");
  } catch (error) {
    state.sounds = sortSounds(FALLBACK_SOUNDS);
    status.textContent = `${state.sounds.length} fallback IDs loaded • import sound_definitions.json for the full list`;
    renderSoundList();
    setStatus(`Catalog sync failed: ${error}. Fallback list is active.`);
  }
}

function importCatalogFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const ids = Object.keys(data.sound_definitions || {});
      if (!ids.length) throw new Error("No sound_definitions object found");
      state.sounds = sortSounds(ids);
      $("#catalogStatus").textContent = `${state.sounds.length.toLocaleString()} imported sound IDs loaded`;
      renderSoundList();
      setStatus("Imported catalog loaded.");
    } catch (error) {
      setStatus(`Catalog import failed: ${error}`);
    }
  };
  reader.readAsText(file);
}

function renderSoundList() {
  const query = $("#soundSearch").value.trim().toLowerCase();
  const list = $("#soundList");
  list.replaceChildren();
  const matches = state.sounds.filter((id) => !query || id.includes(query)).slice(0, 600);
  for (const sound of matches) {
    const button = document.createElement("button");
    button.className = "sound-item" + (sound === state.selectedSound ? " selected" : "");
    button.textContent = sound;
    button.title = `Category: ${soundCategory(sound)}\nClick to assign to channel ${state.selectedChannel + 1}`;
    button.onclick = () => {
      state.selectedSound = sound;
      const channel = state.channels[state.selectedChannel];
      if (channel) {
        channel.sound = sound;
        channel.name = sound.split(".").slice(-2).join(" ").replaceAll("_", " ");
      }
      renderAll();
      synthPreview(60, 0.12, channel?.volume ?? 0.7);
      setStatus(`Assigned ${sound} to channel ${state.selectedChannel + 1}.`);
    };
    list.append(button);
  }
  if (state.sounds.filter((id) => !query || id.includes(query)).length > 600) {
    const note = document.createElement("div");
    note.className = "catalog-status";
    note.textContent = "Showing the first 600 matches. Refine the search to narrow the list.";
    list.append(note);
  }
}

function renderStepNumbers() {
  const row = $("#stepNumbers");
  row.style.setProperty("--steps", state.steps);
  row.replaceChildren();
  const blank = document.createElement("span");
  blank.textContent = "CHANNEL / SOUND";
  row.append(blank);
  for (let i = 0; i < state.steps; i++) {
    const span = document.createElement("span");
    span.textContent = i + 1;
    row.append(span);
  }
}

function renderRack() {
  const rack = $("#channelRack");
  rack.style.setProperty("--steps", state.steps);
  rack.replaceChildren();
  state.channels.forEach((channel, channelIndex) => {
    const row = document.createElement("div");
    row.className = "channel-row";
    row.style.setProperty("--steps", state.steps);

    const head = document.createElement("button");
    head.className = "channel-head";
    head.onclick = () => {
      state.selectedChannel = channelIndex;
      state.selectedSound = channel.sound;
      renderAll();
    };
    head.innerHTML = `<span class="channel-color" style="background:${COLORS[channelIndex % COLORS.length]}"></span>
      <span class="channel-name" title="${channel.sound}">${channel.name}</span>`;

    const del = document.createElement("button");
    del.className = "channel-delete";
    del.textContent = "×";
    del.title = "Delete channel";
    del.onclick = (event) => {
      event.stopPropagation();
      state.channels.splice(channelIndex, 1);
      state.pianoNotes = state.pianoNotes
        .filter((note) => note.channel !== channelIndex)
        .map((note) => ({ ...note, channel: note.channel > channelIndex ? note.channel - 1 : note.channel }));
      state.selectedChannel = Math.max(0, Math.min(state.selectedChannel, state.channels.length - 1));
      renderAll();
    };
    head.append(del);
    if (channelIndex === state.selectedChannel) head.style.outline = "1px solid var(--accent)";
    row.append(head);

    for (let step = 0; step < state.steps; step++) {
      const button = document.createElement("button");
      button.className = "step" + (step % 4 === 0 ? " beat" : "") + (channel.steps.includes(step) ? " on" : "");
      button.dataset.step = step;
      button.dataset.channel = channelIndex;
      button.onclick = () => {
        const index = channel.steps.indexOf(step);
        if (index >= 0) channel.steps.splice(index, 1);
        else channel.steps.push(step);
        channel.steps.sort((a,b) => a-b);
        synthPreview(48 + channelIndex * 4, 0.07, channel.volume);
        renderAll();
      };
      row.append(button);
    }
    rack.append(row);
  });
}

function pitchFromMidi(midi) {
  return Math.max(0.1, Math.min(4, Math.pow(2, (midi - 60) / 12)));
}

function renderPiano() {
  const keys = $("#pianoKeys");
  const grid = $("#pianoGrid");
  keys.replaceChildren();
  grid.replaceChildren();
  const high = 84;
  const low = 48;
  const rowHeight = 24;
  const stepWidth = 28;
  const totalRows = high - low + 1;
  grid.style.height = `${totalRows * rowHeight}px`;
  grid.style.width = `${Math.max(900, state.steps * stepWidth)}px`;

  for (let midi = high; midi >= low; midi--) {
    const noteName = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][midi % 12] + (Math.floor(midi / 12) - 1);
    const key = document.createElement("div");
    key.className = "piano-key" + ([1,3,6,8,10].includes(midi % 12) ? " black" : "");
    key.textContent = noteName;
    key.onclick = () => synthPreview(midi, 0.12, state.channels[state.selectedChannel]?.volume ?? 0.7);
    keys.append(key);
  }

  grid.onclick = (event) => {
    if (event.target !== grid || !state.channels.length) return;
    const rect = grid.getBoundingClientRect();
    const step = Math.max(0, Math.min(state.steps - 1, Math.floor((event.clientX - rect.left + grid.scrollLeft) / stepWidth)));
    const row = Math.max(0, Math.min(totalRows - 1, Math.floor((event.clientY - rect.top + grid.scrollTop) / rowHeight)));
    const midi = high - row;
    state.pianoNotes.push({ channel: state.selectedChannel, step, midi, length: 1 });
    synthPreview(midi, 0.12, state.channels[state.selectedChannel]?.volume ?? 0.7);
    renderAll();
  };

  for (const note of state.pianoNotes.filter((n) => n.channel === state.selectedChannel && n.step < state.steps)) {
    const el = document.createElement("div");
    el.className = "piano-note";
    el.style.left = `${note.step * stepWidth + 1}px`;
    el.style.top = `${(high - note.midi) * rowHeight + 2}px`;
    el.style.width = `${Math.max(1, note.length) * stepWidth - 2}px`;
    el.style.background = `linear-gradient(${COLORS[note.channel % COLORS.length]}, #9e5e14)`;
    el.title = `MIDI ${note.midi} • pitch ${pitchFromMidi(note.midi).toFixed(3)}\nClick to remove`;
    el.onclick = (event) => {
      event.stopPropagation();
      const index = state.pianoNotes.indexOf(note);
      if (index >= 0) state.pianoNotes.splice(index, 1);
      renderAll();
    };
    grid.append(el);
  }
  $("#pianoHint").textContent = state.channels[state.selectedChannel]
    ? `Channel ${state.selectedChannel + 1}: ${state.channels[state.selectedChannel].sound}`
    : "Add a channel first";
}

function renderPlaylist() {
  const grid = $("#playlistGrid");
  grid.replaceChildren();
  const width = Math.max(1000, state.steps * 28);
  const height = Math.max(500, state.channels.length * 44 + 60);
  grid.style.minWidth = `${width}px`;
  grid.style.minHeight = `${height}px`;

  state.channels.forEach((channel, index) => {
    const clip = document.createElement("div");
    clip.className = "playlist-clip";
    clip.style.left = "3px";
    clip.style.top = `${index * 44 + 4}px`;
    clip.style.width = `${Math.max(112, state.steps * 28 - 6)}px`;
    clip.style.background = `linear-gradient(${COLORS[index % COLORS.length]}, #7e4a12)`;
    clip.textContent = `${index + 1} • ${channel.name} • ${channel.steps.length} triggers`;
    grid.append(clip);
  });
}

function renderMixer() {
  const mixer = $("#mixer");
  mixer.replaceChildren();
  state.channels.forEach((channel, index) => {
    const strip = document.createElement("div");
    strip.className = "mixer-strip";
    const title = document.createElement("strong");
    title.textContent = `INS ${index + 1} • ${channel.name}`;
    const wrap = document.createElement("div");
    wrap.className = "fader-wrap";
    const fader = document.createElement("input");
    fader.className = "fader";
    fader.type = "range";
    fader.min = "0";
    fader.max = "2";
    fader.step = "0.01";
    fader.value = channel.volume;
    const value = document.createElement("div");
    value.className = "mixer-value";
    value.textContent = `${Math.round(channel.volume * 100)}%`;
    fader.oninput = () => {
      channel.volume = Number(fader.value);
      value.textContent = `${Math.round(channel.volume * 100)}%`;
      updateEventCount();
    };
    wrap.append(fader);
    strip.append(title, wrap, value);
    mixer.append(strip);
  });
}

function renderAll() {
  renderStepNumbers();
  renderRack();
  renderPiano();
  renderPlaylist();
  renderMixer();
  renderSoundList();
  updateEventCount();
}

function createSongObject() {
  const bpm = Math.max(40, Math.min(240, Number($("#bpmInput").value) || 120));
  const lengthBeats = Math.max(1, Math.min(256, Number($("#lengthInput")?.value) || state.steps / 4));
  const title = ($("#titleInput").value || "Untitled Song").trim().slice(0, 48);
  const author = ($("#authorInput")?.value || "Player").trim().slice(0, 32);
  const extraTags = ($("#tagsInput")?.value || "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const tags = [...new Set([...REQUIRED_TAGS, ...extraTags])].filter((tag) => /^[a-z0-9_.:-]{1,64}$/.test(tag));

  const events = [];
  const beatsPerStep = lengthBeats / state.steps;
  state.channels.forEach((channel, channelIndex) => {
    for (const step of channel.steps) {
      if (step >= state.steps) continue;
      events.push({
        beat: Number((step * beatsPerStep).toFixed(4)),
        sound: channel.sound,
        pitch: Number(channel.pitch || 1),
        volume: Number(channel.volume),
        channel: channelIndex
      });
    }
  });
  for (const note of state.pianoNotes) {
    const channel = state.channels[note.channel];
    if (!channel || note.step >= state.steps) continue;
    events.push({
      beat: Number((note.step * beatsPerStep).toFixed(4)),
      sound: channel.sound,
      pitch: Number(pitchFromMidi(note.midi).toFixed(4)),
      volume: Number(channel.volume),
      channel: note.channel
    });
  }
  events.sort((a,b) => a.beat - b.beat || a.channel - b.channel);

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "song";
  return {
    schema: "ms:song@1",
    id: `ms_${slug}_${Date.now().toString(36)}`,
    title,
    author,
    authorId: "web",
    bpm,
    lengthBeats,
    loop: $("#loopInput").checked,
    public: false,
    tags,
    events
  };
}

function updateEventCount() {
  const song = createSongObject();
  $("#eventCount").textContent = `${song.events.length} events • ${state.channels.length} channels`;
}

function downloadSong() {
  const song = createSongObject();
  const blob = new Blob([JSON.stringify(song, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${song.title.replace(/[^a-z0-9_-]+/gi, "_") || "song"}.mssong`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Exported ${song.title} with ${song.events.length} events.`);
}

async function copyCompactJson() {
  const text = JSON.stringify(createSongObject());
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Compact song JSON copied. Paste it into the add-on's Import Compact JSON screen.");
  } catch {
    prompt("Copy the compact song JSON:", text);
  }
}

let audioContext;
function synthPreview(midi = 60, duration = 0.08, volume = 0.6) {
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  gain.gain.setValueAtTime(Math.max(0.001, Math.min(0.15, volume * 0.08)), audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function stopPlayback() {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  $$(".step.playing").forEach((el) => el.classList.remove("playing"));
  $("#playBtn").textContent = "▶";
  setStatus("Playback stopped.");
}

function startPlayback() {
  if (state.playing) return stopPlayback();
  state.playing = true;
  state.playStart = performance.now();
  $("#playBtn").textContent = "Ⅱ";
  const bpm = Math.max(40, Math.min(240, Number($("#bpmInput").value) || 120));
  const stepMs = (60000 / bpm) / 4;
  let lastStep = -1;

  const frame = (now) => {
    if (!state.playing) return;
    const elapsed = now - state.playStart;
    let step = Math.floor(elapsed / stepMs);
    if ($("#loopInput").checked) step %= state.steps;
    if (step >= state.steps) return stopPlayback();

    if (step !== lastStep) {
      $$(".step.playing").forEach((el) => el.classList.remove("playing"));
      $$(`.step[data-step="${step}"]`).forEach((el) => el.classList.add("playing"));
      state.channels.forEach((channel, index) => {
        if (channel.steps.includes(step)) synthPreview(48 + index * 4, 0.07, channel.volume);
      });
      for (const note of state.pianoNotes.filter((note) => note.step === step)) {
        synthPreview(note.midi, 0.12, state.channels[note.channel]?.volume ?? 0.7);
      }
      const beat = step / 4;
      $("#positionText").textContent = `001:${String(Math.floor(beat) + 1).padStart(2,"0")}:${String((step % 4) * 240).padStart(3,"0")}`;
      lastStep = step;
    }
    state.raf = requestAnimationFrame(frame);
  };
  setStatus("Preview playing. This is a synth guide; actual Minecraft sound IDs play inside Bedrock.");
  state.raf = requestAnimationFrame(frame);
}

function addChannel() {
  const sound = state.selectedSound || "note.harp";
  state.channels.push({
    name: sound.split(".").slice(-2).join(" ").replaceAll("_", " "),
    sound,
    volume: 0.75,
    pitch: 1,
    steps: []
  });
  state.selectedChannel = state.channels.length - 1;
  renderAll();
}

function setActiveView(name) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".mobile-nav button").forEach((button) => button.classList.toggle("active", button.dataset.mobileTab === name));
  const view = $(`#${name}View`);
  if (view) view.classList.add("active");
  if (name === "browser") {
    $("#browserPanel").style.display = "grid";
    $(".center").style.display = "none";
  } else {
    $("#browserPanel").style.display = "";
    $(".center").style.display = "";
  }
}

$("#syncCatalogBtn").onclick = syncOfficialCatalog;
$("#catalogFile").onchange = (event) => event.target.files[0] && importCatalogFile(event.target.files[0]);
$("#soundSearch").oninput = renderSoundList;
$("#addChannelBtn").onclick = addChannel;
$("#playBtn").onclick = startPlayback;
$("#stopBtn").onclick = stopPlayback;
$("#recordBtn").onclick = () => setStatus("Record is a visual arm button. Paint steps or piano notes to compose.");
$("#exportBtn").onclick = () => {
  $("#lengthInput").value = state.steps / 4;
  $("#exportDialog").showModal();
};
$("#downloadSongBtn").onclick = downloadSong;
$("#copyJsonBtn").onclick = copyCompactJson;
$("#stepsSelect").onchange = (event) => {
  state.steps = Number(event.target.value);
  renderAll();
};
$("#duplicatePatternBtn").onclick = () => {
  if (state.steps >= 64) return setStatus("Maximum pattern length is 64 steps.");
  const oldSteps = state.steps;
  const nextSteps = Math.min(64, oldSteps * 2);
  for (const channel of state.channels) {
    channel.steps.push(...channel.steps.map((step) => step + oldSteps).filter((step) => step < nextSteps));
    channel.steps = [...new Set(channel.steps)].sort((a,b) => a-b);
  }
  state.pianoNotes.push(...state.pianoNotes.map((note) => ({ ...note, step: note.step + oldSteps })).filter((note) => note.step < nextSteps));
  state.steps = nextSteps;
  $("#stepsSelect").value = String(nextSteps);
  renderAll();
};
$$(".tab").forEach((tab) => tab.onclick = () => setActiveView(tab.dataset.tab));
$$(".mobile-nav button").forEach((button) => button.onclick = () => setActiveView(button.dataset.mobileTab));
$("#bpmInput").oninput = updateEventCount;
$("#titleInput").oninput = updateEventCount;
$("#loopInput").onchange = updateEventCount;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
renderAll();
syncOfficialCatalog();
