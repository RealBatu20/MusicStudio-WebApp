const MS_PRESETS = [
  { id:"neon-pulse", title:"Neon Pulse", subtitle:"Original electro loop", bpm:128, steps:32, channels:[
    {name:"Kick",sound:"note.bd",steps:[0,8,16,24]},{name:"Snare",sound:"note.snare",steps:[8,24]},{name:"Hat",sound:"note.hat",steps:[2,6,10,14,18,22,26,30]},
    {name:"Bass",sound:"note.bass",notes:[[0,45,4],[6,48,2],[8,43,4],[14,50,2],[16,45,4],[22,52,2],[24,43,4],[30,48,2]]},
    {name:"Lead",sound:"note.pling",notes:[[0,69,2],[4,72,2],[8,76,2],[12,72,2],[16,67,2],[20,71,2],[24,74,2],[28,71,2]]}
  ]},
  { id:"redstone-factory", title:"Redstone Factory", subtitle:"Original mechanical groove", bpm:116, steps:32, channels:[
    {name:"Piston Kick",sound:"note.bd",steps:[0,7,16,23]},{name:"Metal",sound:"note.iron_xylophone",notes:[[0,60,1],[3,64,1],[7,67,1],[11,64,1],[16,60,1],[19,65,1],[23,69,1],[27,65,1]]},
    {name:"Clicks",sound:"random.click",steps:[2,6,10,14,18,22,26,30]},{name:"Bass",sound:"note.bass",notes:[[0,43,4],[8,46,4],[16,41,4],[24,48,4]]}
  ]},
  { id:"copper-sky", title:"Copper Sky", subtitle:"Original cinematic chimes", bpm:92, steps:32, channels:[
    {name:"Bell",sound:"note.bell",notes:[[0,60,4],[4,64,4],[8,67,4],[12,72,4],[16,69,4],[20,67,4],[24,64,4],[28,60,4]]},
    {name:"Chime",sound:"note.chime",notes:[[2,72,2],[10,76,2],[18,74,2],[26,79,2]]},{name:"Low",sound:"note.bass",notes:[[0,48,8],[8,43,8],[16,45,8],[24,41,8]]}
  ]},
  { id:"nether-drive", title:"Nether Drive", subtitle:"Original dark rhythm", bpm:140, steps:32, channels:[
    {name:"Kick",sound:"note.bd",steps:[0,4,8,12,16,20,24,28]},{name:"Snare",sound:"note.snare",steps:[8,24]},{name:"Hat",sound:"note.hat",steps:[1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31]},
    {name:"Drone",sound:"note.didgeridoo",notes:[[0,42,8],[8,41,8],[16,39,8],[24,46,8]]},{name:"Lead",sound:"note.bit",notes:[[0,66,2],[3,69,1],[6,71,2],[11,69,1],[16,66,2],[19,74,1],[22,71,2],[27,69,1]]}
  ]},
  { id:"ode-to-joy", title:"Ode to Joy", subtitle:"Beethoven · public domain motif", bpm:112, steps:64, channels:[
    {name:"Harp",sound:"note.harp",notes:[[0,64,4],[4,64,4],[8,65,4],[12,67,4],[16,67,4],[20,65,4],[24,64,4],[28,62,4],[32,60,4],[36,60,4],[40,62,4],[44,64,4],[48,64,6],[54,62,2],[56,62,8]]}
  ]},
  { id:"twinkle", title:"Twinkle", subtitle:"Traditional · public domain", bpm:100, steps:64, channels:[
    {name:"Music Box",sound:"note.chime",notes:[[0,60,4],[4,60,4],[8,67,4],[12,67,4],[16,69,4],[20,69,4],[24,67,8],[32,65,4],[36,65,4],[40,64,4],[44,64,4],[48,62,4],[52,62,4],[56,60,8]]}
  ]},
  { id:"fur-elise", title:"Für Elise Motif", subtitle:"Beethoven · public domain motif", bpm:120, steps:64, channels:[
    {name:"Piano",sound:"note.harp",notes:[[0,76,2],[2,75,2],[4,76,2],[6,75,2],[8,76,2],[10,71,2],[12,74,2],[14,72,2],[16,69,4],[20,60,2],[22,64,2],[24,69,2],[28,71,4],[32,64,2],[34,68,2],[36,71,2],[40,72,4]]}
  ]},
  { id:"creative-calm", title:"Creative Calm", subtitle:"Original ambient starter", bpm:76, steps:64, channels:[
    {name:"Flute",sound:"note.flute",notes:[[0,67,8],[12,72,4],[16,71,8],[28,69,4],[32,64,8],[44,67,4],[48,69,8],[60,67,4]]},
    {name:"Chime",sound:"note.chime",notes:[[4,79,2],[20,76,2],[36,81,2],[52,74,2]]},{name:"Bass",sound:"note.bass",notes:[[0,43,16],[16,40,16],[32,45,16],[48,43,16]]}
  ]}
];
function presetToProject(preset){
  const channels=preset.channels.map((c)=>({id:uid("ch"),name:c.name,sound:c.sound,volume:.78,pitch:1,pan:0,filter:20000,delay:0,mute:false,solo:false,steps:[...(c.steps||[])]}));
  const notes=[];preset.channels.forEach((c,i)=>(c.notes||[]).forEach(([step,midi,length=1,velocity=.82])=>notes.push({channel:i,step,midi,length,velocity})));
  const pattern={id:uid("pat"),name:preset.title,channelSteps:channels.map(c=>[...c.steps]),pianoNotes:notes};
  return {version:4,title:preset.title,bpm:preset.bpm,swing:0,master:.85,loop:true,metronome:false,playbackMode:"pattern",selectedSound:channels[0]?.sound||"note.harp",selectedChannel:0,steps:preset.steps,channels,pianoNotes:copy(notes),patterns:[pattern],activePatternId:pattern.id,playlistBars:Math.max(8,Math.ceil(preset.steps/16)),playlistTracks:8,playlistClips:[],selectedClipId:null};
}
function loadPreset(id){const preset=MS_PRESETS.find(p=>p.id===id);if(!preset)return;pushHistory();restoreCore(presetToProject(preset));$("#presetDialog").close();setStatus(`Loaded preset: ${preset.title}.`);}
function renderPresets(){const host=$("#presetList");if(!host)return;host.replaceChildren();for(const p of MS_PRESETS){const card=document.createElement("article");card.className="preset-card";card.innerHTML=`<div class="preset-wave" aria-hidden="true"></div><div><strong>${escapeHtml(p.title)}</strong><span>${escapeHtml(p.subtitle)}</span><small>${p.bpm} BPM · ${p.steps} steps · ${p.channels.length} channels</small></div><button>LOAD</button>`;card.querySelector("button").onclick=()=>loadPreset(p.id);host.append(card);}}
function bindPresetUi(){$("#presetsBtn")?.addEventListener("click",()=>{$("#presetDialog").showModal();renderPresets();});$("#presetMenuBtn")?.addEventListener("click",()=>{$("#presetDialog").showModal();renderPresets();});}
