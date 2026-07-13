let transcriberBuffer=null;let transcriberFile=null;let ffmpegInstance=null;let ffmpegModules=null;
const FFMPEG_PKG="https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js";
const FFMPEG_UTIL="https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js";
const FFMPEG_CORE="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
function transcribeLog(text,error=false){const host=$("#transcribeLog");if(!host)return;const line=document.createElement("div");line.className=error?"log-line error":"log-line";line.textContent=text;host.prepend(line);while(host.children.length>80)host.lastChild.remove();}
async function loadFfmpeg(){
  if(ffmpegInstance)return ffmpegInstance;transcribeLog("Loading FFmpeg WebAssembly (~31 MB)…");
  const [{FFmpeg},{fetchFile,toBlobURL}]=await Promise.all([import(FFMPEG_PKG),import(FFMPEG_UTIL)]);const ffmpeg=new FFmpeg();ffmpeg.on("log",({message})=>transcribeLog(message));
  await ffmpeg.load({coreURL:await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`,"text/javascript"),wasmURL:await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`,"application/wasm")});
  ffmpegInstance=ffmpeg;ffmpegModules={fetchFile};return ffmpeg;
}
async function decodeUniversalAudio(file){
  const context=getAudioContext();const bytes=await file.arrayBuffer();
  try{return await context.decodeAudioData(bytes.slice(0));}catch(first){transcribeLog(`Browser decoder could not open ${file.name}; trying FFmpeg…`);}
  const ffmpeg=await loadFfmpeg();const input=`input_${Date.now()}_${file.name.replace(/[^a-z0-9_.-]/gi,"_")}`;const output=`output_${Date.now()}.wav`;
  await ffmpeg.writeFile(input,await ffmpegModules.fetchFile(file));await ffmpeg.exec(["-i",input,"-vn","-ac","1","-ar","22050","-f","wav",output]);const wav=await ffmpeg.readFile(output);await ffmpeg.deleteFile(input).catch(()=>{});await ffmpeg.deleteFile(output).catch(()=>{});return await context.decodeAudioData(wav.buffer.slice(0));
}
function monoSamples(buffer,maxSeconds){const len=Math.min(buffer.length,Math.floor(buffer.sampleRate*maxSeconds));const out=new Float32Array(len);for(let c=0;c<buffer.numberOfChannels;c++){const data=buffer.getChannelData(c);for(let i=0;i<len;i++)out[i]+=data[i]/buffer.numberOfChannels;}return out;}
function estimateBpm(samples,sr){
  const hop=512,frames=Math.floor(samples.length/hop),energy=new Float32Array(frames);for(let f=0;f<frames;f++){let sum=0;for(let i=0;i<hop;i++){const v=samples[f*hop+i]||0;sum+=v*v;}energy[f]=Math.sqrt(sum/hop);}
  const onset=new Float32Array(frames);for(let i=1;i<frames;i++)onset[i]=Math.max(0,energy[i]-energy[i-1]);let best=120,bestScore=-1;
  for(let bpm=60;bpm<=200;bpm++){const lag=Math.round((60/bpm)*sr/hop);let score=0;for(let i=lag;i<frames;i++)score+=onset[i]*onset[i-lag];if(score>bestScore){bestScore=score;best=bpm;}}
  return best;
}
function fft(real,imag){const n=real.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wlr=Math.cos(ang),wli=Math.sin(ang);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const uR=real[i+j],uI=imag[i+j],vR=real[i+j+len/2]*wr-imag[i+j+len/2]*wi,vI=real[i+j+len/2]*wi+imag[i+j+len/2]*wr;real[i+j]=uR+vR;imag[i+j]=uI+vI;real[i+j+len/2]=uR-vR;imag[i+j+len/2]=uI-vI;const next=wr*wlr-wi*wli;wi=wr*wli+wi*wlr;wr=next;}}}}
function analyzeFrame(samples,start,sr,fftSize,polyphony,sensitivity){
  const real=new Float64Array(fftSize),imag=new Float64Array(fftSize);let rms=0,zcr=0,prev=0;
  for(let i=0;i<fftSize;i++){const v=samples[start+i]||0;const w=.5-.5*Math.cos(2*Math.PI*i/(fftSize-1));real[i]=v*w;rms+=v*v;if(i&&Math.sign(v)!==Math.sign(prev))zcr++;prev=v;}rms=Math.sqrt(rms/fftSize);if(rms<0.008*(1.15-sensitivity))return {rms,notes:[],percussion:null};fft(real,imag);
  const mags=[],minBin=Math.max(2,Math.floor(55*fftSize/sr)),maxBin=Math.min(fftSize/2-2,Math.ceil(4200*fftSize/sr));let max=0,total=0,weighted=0;
  for(let k=minBin;k<=maxBin;k++){const m=Math.hypot(real[k],imag[k]);mags[k]=m;max=Math.max(max,m);total+=m;weighted+=m*(k*sr/fftSize);}
  const centroid=total?weighted/total:0;const peaks=[];for(let k=minBin+1;k<maxBin;k++)if(mags[k]>mags[k-1]&&mags[k]>=mags[k+1]&&mags[k]>max*(.16-.1*sensitivity))peaks.push({freq:k*sr/fftSize,mag:mags[k]});peaks.sort((a,b)=>b.mag-a.mag);
  const notes=[];for(const p of peaks){const midi=Math.round(69+12*Math.log2(p.freq/440));if(notes.some(n=>Math.abs(n.midi-midi)<2))continue;notes.push({midi,velocity:clamp(rms*5,0.15,1),freq:p.freq});if(notes.length>=polyphony)break;}
  const transient=zcr/fftSize>.18||centroid>3200;let percussion=null;if(transient&&rms>.025)percussion=centroid>3500?"note.hat":(centroid<500?"note.bd":"note.snare");return {rms,notes,percussion,centroid};
}
function foldNoteBlockMidi(midi){while(midi<54)midi+=12;while(midi>78)midi-=12;return clamp(midi,54,78);}
function instrumentFor(note,centroid){if(note.midi<52)return"note.bass";if(centroid>2600)return"note.flute";if(note.midi>74)return"note.bell";return"note.harp";}
async function transcribeBuffer(){
  if(!transcriberBuffer)return setStatus("Choose an audio file first.");const maxSeconds=clamp(Number($("#transcribeDuration").value)||90,5,300);const samples=monoSamples(transcriberBuffer,maxSeconds),sr=transcriberBuffer.sampleRate;
  let bpm=$("#transcribeBpmMode").value==="manual"?clamp(Number($("#transcribeBpm").value)||120,40,300):estimateBpm(samples,sr);$("#transcribeBpm").value=bpm;
  const spb=Number($("#transcribeResolution").value)||4,polyphony=clamp(Number($("#transcribePolyphony").value)||2,1,4),sensitivity=Number($("#transcribeSensitivity").value)||.55;
  const secondsPerStep=60/bpm/spb,totalSteps=Math.min(4096,Math.floor(Math.min(maxSeconds,transcriberBuffer.duration)/secondsPerStep));const fftSize=4096;const events=[];transcribeLog(`Analyzing ${totalSteps} grid positions at ${bpm} BPM…`);$("#transcribeProgress").value=0;
  for(let step=0;step<totalSteps;step++){const center=Math.floor(step*secondsPerStep*sr),start=Math.max(0,Math.min(samples.length-fftSize,center-Math.floor(fftSize/2)));const frame=analyzeFrame(samples,start,sr,fftSize,polyphony,sensitivity);if(frame.percussion)events.push({step,instrument:frame.percussion,midi:60,velocity:clamp(frame.rms*5,.2,1),percussion:true});for(const note of frame.notes)events.push({step,instrument:instrumentFor(note,frame.centroid),midi:foldNoteBlockMidi(note.midi),velocity:note.velocity,percussion:false});if(step%32===0){$("#transcribeProgress").value=step/totalSteps;await new Promise(r=>setTimeout(r,0));}}
  $("#transcribeProgress").value=1;applyTranscription(events,bpm,totalSteps,spb);transcribeLog(`Created ${events.length.toLocaleString()} note events across ${Math.ceil(totalSteps/64)} patterns.`);setStatus(`Audio transcription complete: ${events.length} note-block events.`);
}
function applyTranscription(events,bpm,totalSteps,spb){
  const instruments=[...new Set(events.map(e=>e.instrument))];const channels=instruments.map((sound,i)=>({id:uid("ch"),name:sound.replace("note.","").replaceAll("_"," ").replace(/^./,c=>c.toUpperCase()),sound,volume:.78,pitch:1,pan:instruments.length>1?(i/(instruments.length-1)-.5)*.7:0,filter:20000,delay:0,mute:false,solo:false,steps:[]}));const index=new Map(instruments.map((s,i)=>[s,i]));const chunk=64,patterns=[];
  for(let base=0,pi=0;base<totalSteps;base+=chunk,pi++){const channelSteps=channels.map(()=>[]),notes=[];for(const e of events)if(e.step>=base&&e.step<base+chunk){const ch=index.get(e.instrument),local=e.step-base;if(e.percussion)channelSteps[ch].push(local);else notes.push({channel:ch,step:local,midi:e.midi,length:1,velocity:e.velocity});}patterns.push({id:uid("pat"),name:`Transcribed ${pi+1}`,channelSteps,pianoNotes:notes});}
  const clips=patterns.map((p,i)=>({id:uid("clip"),patternId:p.id,startStep:i*chunk,lengthSteps:Math.min(chunk,totalSteps-i*chunk),track:0}));const first=patterns[0]||{id:uid("pat"),name:"Transcribed",channelSteps:channels.map(()=>[]),pianoNotes:[]};channels.forEach((c,i)=>c.steps=[...(first.channelSteps[i]||[])]);
  restoreCore({version:4,title:(transcriberFile?.name||"Audio Transcription").replace(/\.[^.]+$/,"").slice(0,48),bpm,swing:0,master:.85,loop:false,metronome:false,playbackMode:"song",selectedSound:channels[0]?.sound||"note.harp",selectedChannel:0,steps:64,channels,pianoNotes:copy(first.pianoNotes),patterns,activePatternId:first.id,playlistBars:Math.max(8,Math.ceil(totalSteps/16)),playlistTracks:8,playlistClips:clips,selectedClipId:null});
}
async function selectTranscribeFile(file){transcriberFile=file;$("#transcribeFileName").textContent=`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;$("#transcribeLog").replaceChildren();try{transcribeLog("Decoding audio…");
    if(FSB_EXTENSIONS.test(file.name)){
      await loadVgmstream();
      const meta=await askVgmstream("probe-bank",{file});
      if((meta.streamCount||1)>1) throw new Error(`This FSB contains ${meta.streamCount} subsongs. Load it in Audio Asset Vault, select a stream, then use “USE SELECTED FSB STREAM”.`);
      const decoded=await askVgmstream("decode-stream",{file,index:1});
      transcriberBuffer=await getAudioContext().decodeAudioData(decoded.arrayBuffer.slice(0));
    }else transcriberBuffer=await decodeUniversalAudio(file);transcribeLog(`Decoded ${transcriberBuffer.duration.toFixed(2)}s · ${transcriberBuffer.sampleRate} Hz · ${transcriberBuffer.numberOfChannels} channel(s)`);$("#transcribeDuration").value=Math.min(300,Math.ceil(transcriberBuffer.duration));setStatus(`Ready to transcribe ${file.name}.`);}catch(e){transcribeLog(`Decode failed: ${e.message}`,true);setStatus(`Audio decode failed: ${e.message}`);}}
function playReference(){if(!transcriberBuffer)return;const source=getAudioContext().createBufferSource();source.buffer=transcriberBuffer;source.connect(masterGain);source.start();setStatus("Playing original reference audio.");}
async function useSelectedFsbForTranscription(){
  if(!selectedFsbRecord)return setStatus("Select an FSB subsong in Audio Asset Vault first.");
  try{
    transcribeLog(`Decoding ${selectedFsbRecord.name}…`);
    const bytes=await decodeFsbRecord(selectedFsbRecord);
    transcriberBuffer=await getAudioContext().decodeAudioData(bytes.slice(0));
    transcriberFile={name:`${selectedFsbRecord.bankName}_${selectedFsbRecord.subsong}.fsb`,size:selectedFsbRecord.file.size};
    $("#transcribeFileName").textContent=`${selectedFsbRecord.name} · ${selectedFsbRecord.bankName} #${selectedFsbRecord.subsong}`;
    $("#transcribeDuration").value=Math.min(300,Math.ceil(transcriberBuffer.duration));
    setStatus(`Ready to transcribe ${selectedFsbRecord.name}.`);
  }catch(e){transcribeLog(`FSB decode failed: ${e.message}`,true);setStatus(e.message);}
}
function bindTranscriberUi(){$("#converterBtn")?.addEventListener("click",()=>$("#transcriberDialog").showModal());$("#transcribeFileInput")?.addEventListener("change",e=>e.target.files[0]&&selectTranscribeFile(e.target.files[0]));$("#startTranscribeBtn")?.addEventListener("click",transcribeBuffer);$("#playReferenceBtn")?.addEventListener("click",playReference);$("#useSelectedFsbBtn")?.addEventListener("click",useSelectedFsbForTranscription);$("#playNotesBtn")?.addEventListener("click",()=>{$("#transcriberDialog").close();setPlaybackMode("song");startPlayback();});}
