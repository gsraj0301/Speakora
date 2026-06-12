const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";

const sessionState = {
  postureScores: [],
  frameCount: 0,
  lastVideoTime: -1,
  poseLandmarker: null,
  mediaRecorder: null,
  audioChunks: [],
  transcript: '',
  fillerCount: 0,
  wordCount: 0,
  startTime: null,
  paceInterval: null,
  timerInterval: null,
  coachingTips: [],
  pace: 0,
  sessionActive: false,
  webSpeechFailed: false,
  eyeContactFrames: 0,
  totalFrames: 0,
  gestureCount: 0,
  lastWristPos: null,
  openFrames: 0,
  showVideo: false
};

const singleWordFillers = ['um', 'uh', 'like', 'emm', 'ah'];
const multiWordFillers = ['you know', 'i mean', 'kind of', 'sort of'];

function status(msg) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = msg;
}

function countFillers(text) {
  const lower = text.toLowerCase();
  for (const phrase of multiWordFillers) {
    const regex = new RegExp(phrase.replace(/\s+/g, '\\s+'), 'g');
    const matches = lower.match(regex);
    if (matches) sessionState.fillerCount += matches.length;
  }
  for (const word of singleWordFillers) {
    const regex = new RegExp('\\b' + word + '\\b', 'g');
    const matches = lower.match(regex);
    if (matches) sessionState.fillerCount += matches.length;
  }
}

function countWords(text) {
  sessionState.wordCount += text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function updatePace() {
  const minutes = (Date.now() - sessionState.startTime) / 60000;
  if (minutes > 0) sessionState.pace = Math.round(sessionState.wordCount / minutes);
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - sessionState.startTime) / 1000);
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = `${m}:${s}`;
}

function getCSRF() {
  const c = document.cookie.match(/csrftoken=([^;]+)/);
  return c ? c[1] : '';
}

async function transcribeAudio() {
  if (sessionState.audioChunks.length === 0) return '';
  const mimeType = sessionState.mediaRecorder ? sessionState.mediaRecorder.mimeType : 'audio/webm';
  const blob = new Blob(sessionState.audioChunks, { type: mimeType });
  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');
  const res = await fetch('/api/transcribe/', {
    method: 'POST', body: fd,
    headers: { 'X-CSRFToken': getCSRF() }
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Whisper error:', data);
    return '';
  }
  return (data.text || '').trim();
}

function startRecording(stream) {
  sessionState.mediaRecorder = new MediaRecorder(stream);
  sessionState.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) sessionState.audioChunks.push(event.data);
  };
  sessionState.mediaRecorder.start();
}

function tryWebSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recog = new SpeechRecognition();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = 'en-US';

  recog.onresult = (event) => {
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      }
    }
    if (final) {
      const trimmed = final.trim();
      sessionState.transcript += (sessionState.transcript ? ' ' : '') + trimmed;
      countFillers(trimmed);
      countWords(trimmed);
    }
  };

  recog.onend = () => {
    if (sessionState.sessionActive && !sessionState.webSpeechFailed) {
      try { recog.start(); } catch (e) {}
    }
  };

  recog.onerror = (event) => {
    if (event.error === 'network') {
      sessionState.webSpeechFailed = true;
      status('Web Speech unavailable; recorded audio will be transcribed via Whisper.');
    }
  };

  recog.start();
  sessionState.recognition = recog;
}

async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
  const video = document.getElementById('webcam');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  return stream;
}

async function transcribeAndProcess() {
  const text = await transcribeAudio();
  if (text) {
    sessionState.transcript += (sessionState.transcript ? ' ' : '') + text;
    countFillers(text);
    countWords(text);
  }
  return text;
}

async function init() {
  try {
    const statusEl = document.getElementById('loadingText');
    statusEl.textContent = 'Starting camera...';
    const stream = await startWebcam();
    const video = document.getElementById('webcam');
    statusEl.textContent = 'Loading pose detection... (first load may take 10s)';

    const vision = await import(MP_CDN);
    const { PoseLandmarker, FilesetResolver, DrawingUtils } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
    sessionState.poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: 'VIDEO'
    });
    statusEl.classList.add('hidden');
    detectLoop(video, DrawingUtils, PoseLandmarker);
    sessionState.startTime = Date.now();
    sessionState.paceInterval = setInterval(updatePace, 5000);
    sessionState.timerInterval = setInterval(updateTimer, 1000);
    startRecording(stream);
    sessionState.sessionActive = true;
    tryWebSpeech();
  } catch (err) {
    document.getElementById('loadingText').textContent = 'Error: ' + err.message;
    console.error('Init error:', err);
  }
}

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('loadingText').classList.remove('hidden');
  document.getElementById('loadingText').textContent = 'Opening camera...';
  init();
});

function detectLoop(video, DrawingUtils, PoseLandmarker) {
  const canvas = document.getElementById('pose-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.style.width = video.videoWidth + 'px';
  canvas.style.height = video.videoHeight + 'px';
  const drawingUtils = new DrawingUtils(ctx);

  function detect() {
    if (video.currentTime !== sessionState.lastVideoTime) {
      sessionState.lastVideoTime = video.currentTime;
      const result = sessionState.poseLandmarker.detectForVideo(video, performance.now());

      if (sessionState.showVideo) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        const gradient = ctx.createRadialGradient(
          canvas.width/2, canvas.height/2, 0,
          canvas.width/2, canvas.height/2, Math.max(canvas.width, canvas.height) * 0.7
        );
        gradient.addColorStop(0, '#0a0f12');
        gradient.addColorStop(1, '#000000');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-canvas.width, 0);
      if (result.landmarks && result.landmarks[0]) {
        const landmarks = result.landmarks[0];
        drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
          color: "#00e5ff", lineWidth: 2
        });
        drawingUtils.drawLandmarks(landmarks, { color: "#00b8d4", lineWidth: 1.5 });

        sessionState.frameCount++;
        if (sessionState.frameCount % 30 === 0) {
          analyzePosture(landmarks);
          if (analyzeEyeContact(landmarks)) sessionState.eyeContactFrames++;
          sessionState.totalFrames++;
          analyzeGestures(landmarks);
          if (analyzeOpenness(landmarks)) sessionState.openFrames++;
        }
      }
      ctx.restore();
    }
    requestAnimationFrame(detect);
  }
  detect();
}

function analyzePosture(landmarks) {
  const ls = landmarks[11], rs = landmarks[12];
  const le = landmarks[7], re = landmarks[8];
  const shoulderTilt = Math.abs(ls.y - rs.y);
  const angleRadL = Math.atan2(ls.y - le.y, ls.x - le.x);
  const angleRadR = Math.atan2(rs.y - re.y, rs.x - re.x);
  const neckTilt = Math.abs(angleRadL - angleRadR) * 180 / Math.PI;

  let score = 100;
  if (shoulderTilt > 0.05) score -= 10;
  if (neckTilt > 30) score -= 15;
  if (score < 0) score = 0;

  sessionState.postureScores.push(score);
}

function analyzeEyeContact(landmarks) {
  const nose = landmarks[0];
  const horizontalDrift = Math.abs(nose.x - 0.5);
  const verticalDrift = nose.y;
  if (horizontalDrift > 0.08) return false;
  if (verticalDrift > 0.55) return false;
  return true;
}

function analyzeGestures(landmarks) {
  const lw = landmarks[15], rw = landmarks[16];
  if (sessionState.lastWristPos) {
    const lDelta = Math.hypot(lw.x - sessionState.lastWristPos.lx, lw.y - sessionState.lastWristPos.ly);
    const rDelta = Math.hypot(rw.x - sessionState.lastWristPos.rx, rw.y - sessionState.lastWristPos.ry);
    if (lDelta > 0.02 || rDelta > 0.02) sessionState.gestureCount++;
  }
  sessionState.lastWristPos = { lx: lw.x, ly: lw.y, rx: rw.x, ry: rw.y };
}

function analyzeOpenness(landmarks) {
  const ls = landmarks[11], rs = landmarks[12];
  const lw = landmarks[15], rw = landmarks[16];
  const lOpen = Math.hypot(lw.x - ls.x, lw.y - ls.y);
  const rOpen = Math.hypot(rw.x - rs.x, rw.y - rs.y);
  const avg = (lOpen + rOpen) / 2;
  return avg > 0.15;
}

document.getElementById('getFeedbackBtn').addEventListener('click', async () => {
  document.getElementById('getFeedbackBtn').textContent = '⏳ Processing...';
  document.getElementById('getFeedbackBtn').disabled = true;
  sessionState.sessionActive = false;
  if (sessionState.recognition) {
    sessionState.recognition.stop();
  }
  if (sessionState.mediaRecorder && sessionState.mediaRecorder.state !== 'inactive') {
    await new Promise(resolve => {
      sessionState.mediaRecorder.onstop = resolve;
      sessionState.mediaRecorder.stop();
    });
  }
  clearInterval(sessionState.paceInterval);
  clearInterval(sessionState.timerInterval);
  const webcam = document.getElementById('webcam');
  if (webcam) webcam.srcObject = null;

  await transcribeAndProcess();

  const seconds = sessionState.startTime ? Math.round((Date.now() - sessionState.startTime) / 1000) : 0;
  const minutes = sessionState.startTime ? (Date.now() - sessionState.startTime) / 60000 : 0;
  const avgPosture = sessionState.postureScores.length > 0
    ? Math.round(sessionState.postureScores.reduce((a, b) => a + b, 0) / sessionState.postureScores.length)
    : 0;

  console.log('=== FEEDBACK DATA ===');
  console.log('transcript:', sessionState.transcript);
  console.log('wordCount:', sessionState.wordCount);
  console.log('minutes:', minutes);
  console.log('pace:', minutes > 0 ? Math.round(sessionState.wordCount / minutes) : 0);
  console.log('fillerCount:', sessionState.fillerCount);
  console.log('postureScore:', avgPosture);
  console.log('duration sec:', seconds);

  const eyeContactPct = sessionState.totalFrames > 0
    ? Math.round((sessionState.eyeContactFrames / sessionState.totalFrames) * 100) : 0;
  const gesturesPerMin = minutes > 0
    ? Math.round(sessionState.gestureCount / minutes) : 0;
  const opennessPct = sessionState.totalFrames > 0
    ? Math.round((sessionState.openFrames / sessionState.totalFrames) * 100) : 0;

  console.log('eyeContact%:', eyeContactPct);
  console.log('gestures/min:', gesturesPerMin);
  console.log('openness%:', opennessPct);

  if (seconds < 15) {
    sessionState.coachingTips.push('Please speak for at least five minutes before our agents can analyze your presentation and give you feedback.');
  } else {
    try {
      const res = await fetch('/api/coach/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: sessionState.transcript,
          filler_count: sessionState.fillerCount,
          pace: minutes > 0 ? Math.round(sessionState.wordCount / minutes) : 0,
          posture_score: avgPosture,
          eye_contact: eyeContactPct,
          gesture_rate: gesturesPerMin,
          openness: opennessPct
        })
      });
      const data = await res.json();
      if (data.tip) {
        sessionState.coachingTips.push(data.tip);
        const utterance = new SpeechSynthesisUtterance(data.tip);
        speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.error('Coach error:', e);
    }
  }

  const payload = {
    duration: seconds,
    fillerCount: sessionState.fillerCount,
    pace: minutes > 0 ? Math.round(sessionState.wordCount / minutes) : 0,
    postureScore: avgPosture,
    eyeContactScore: eyeContactPct,
    gesturesPerMinute: gesturesPerMin,
    opennessScore: opennessPct,
    postureScores: sessionState.postureScores,
    tips: sessionState.coachingTips,
    transcript: sessionState.transcript
  };
  try {
    const res = await fetch('/api/save-session/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.id) {
      window.location.href = '/results/?session_id=' + result.id;
      return;
    }
  } catch (e) {
    console.error('Save error:', e);
  }
  sessionStorage.setItem('sessionData', JSON.stringify(payload));
  window.location.href = '/results/';
});

document.getElementById('toggleVideoBtn').addEventListener('click', () => {
  sessionState.showVideo = !sessionState.showVideo;
  const icon = document.getElementById('toggleIcon');
  if (sessionState.showVideo) {
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M22 10.5V12m0 0v1.5m0-1.5h-1.5m1.5 0H22M7.878 15.173a3 3 0 01-2.228 2.036l-.854.14a.25.25 0 01-.295-.251V9.392a.25.25 0 01.295-.251l.854.14a3 3 0 012.228 2.036 9.002 9.002 0 000 3.856z" />';
  } else {
    icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />';
  }
});
