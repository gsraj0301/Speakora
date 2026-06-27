const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";

let streamRef = null;

const sessionState = {
  postureScores: [],
  frameCount: 0,
  lastVideoTime: -1,
  faceLandmarker: null,
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
  smileFrames: 0,
  blinkCount: 0,
  lastBlinkState: false,
  baselineBrowY: null,
  eyebrowRaiseCount: 0,
  mouthOpennessValues: [],
  showVideo: false,
  stopLoop: false
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

function fetchWithTimeout(url, opts, ms = 60000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function transcribeAudio() {
  if (sessionState.audioChunks.length === 0) return '';
  const raw = sessionState.mediaRecorder ? sessionState.mediaRecorder.mimeType : '';
  const mimeType = raw && raw !== '' ? raw : 'audio/webm;codecs=opus';
  const blob = new Blob(sessionState.audioChunks, { type: mimeType });
  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');
  try {
    const res = await fetchWithTimeout('/api/transcribe/', {
      method: 'POST', body: fd,
      headers: { 'X-CSRFToken': getCSRF() }
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Whisper error:', data);
      return '';
    }
    return (data.text || '').trim();
  } catch (e) {
    if (e.name === 'AbortError') console.error('Whisper timed out');
    else console.error('Whisper error:', e);
    return '';
  }
}

function startRecording(stream) {
  sessionState.mediaRecorder = new MediaRecorder(stream);
  sessionState.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) sessionState.audioChunks.push(event.data);
  };
  sessionState.mediaRecorder.onerror = () => {
    console.error('MediaRecorder error');
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

function stopStream() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
}

async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
  streamRef = stream;
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
    statusEl.textContent = 'Loading face detection... (first load may take 10s)';

    const vision = await import(MP_CDN);
    const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

    const filesetResolver = await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
    sessionState.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
        delegate: "GPU"
      },
      runningMode: 'VIDEO',
      outputFaceBlendshapes: false,
      refineLandmarks: true
    });
    statusEl.classList.add('hidden');
    detectLoop(video, DrawingUtils, FaceLandmarker);
    sessionState.startTime = Date.now();
    sessionState.paceInterval = setInterval(updatePace, 5000);
    sessionState.timerInterval = setInterval(updateTimer, 1000);
    startRecording(stream);
    sessionState.sessionActive = true;
    tryWebSpeech();
  } catch (err) {
    document.getElementById('loadingText').textContent = 'Error: ' + err.message;
    console.error('Init error:', err);
    stopStream();
    initStarted = false;
  }
}

let initStarted = false;

document.getElementById('startBtn').addEventListener('click', () => {
  if (initStarted) return;
  initStarted = true;
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('loadingText').classList.remove('hidden');
  document.getElementById('loadingText').textContent = 'Opening camera...';
  init().catch(() => { initStarted = false; });
});

window.addEventListener('beforeunload', () => {
  stopStream();
  if (sessionState.recognition) {
    try { sessionState.recognition.abort(); } catch (e) {}
  }
  sessionState.sessionActive = false;
  sessionState.stopLoop = true;
  clearInterval(sessionState.paceInterval);
  clearInterval(sessionState.timerInterval);
});

function detectLoop(video, DrawingUtils, FaceLandmarker) {
  const canvas = document.getElementById('pose-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.style.width = video.videoWidth + 'px';
  canvas.style.height = video.videoHeight + 'px';
  const drawingUtils = new DrawingUtils(ctx);

  let frameId = null;

  function detect() {
    if (sessionState.stopLoop) {
      if (frameId) cancelAnimationFrame(frameId);
      return;
    }
    if (!sessionState.faceLandmarker) { frameId = requestAnimationFrame(detect); return; }
    if (video.currentTime !== sessionState.lastVideoTime) {
      sessionState.lastVideoTime = video.currentTime;
      const result = sessionState.faceLandmarker.detectForVideo(video, performance.now());

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
        const groups = [
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_FACE_OVAL, color: "#00e5ff", width: 1.5 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_LEFT_EYE, color: "#00e5ff", width: 1 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_RIGHT_EYE, color: "#00e5ff", width: 1 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_LEFT_EYEBROW, color: "#00b8d4", width: 1 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_RIGHT_EYEBROW, color: "#00b8d4", width: 1 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_NOSE, color: "#00e5ff", width: 1 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_UPPER_LIP, color: "#4dd0e1", width: 1 },
          { conn: FaceLandmarker.FACE_LANDMARKS_CONTOURS_LOWER_LIP, color: "#4dd0e1", width: 1 },
        ];
        for (const g of groups) {
          drawingUtils.drawConnectors(landmarks, g.conn, { color: g.color, lineWidth: g.width });
        }

        sessionState.frameCount++;
        if (sessionState.frameCount % 30 === 0) {
          sessionState.postureScores.push(analyzeHeadPosition(landmarks));
          if (analyzeEyeContact(landmarks)) sessionState.eyeContactFrames++;
          if (analyzeExpression(landmarks)) sessionState.smileFrames++;
          analyzeMouthOpenness(landmarks);
          analyzeBlink(landmarks);
          analyzeEyebrowRaise(landmarks);
          sessionState.totalFrames++;
        }
      }
      ctx.restore();
    }
    frameId = requestAnimationFrame(detect);
  }
  detect();
}

function analyzeHeadPosition(landmarks) {
  const nose = landmarks[4], chin = landmarks[152];
  const lEar = landmarks[234], rEar = landmarks[454];

  let score = 100;
  const headAngle = Math.atan2(Math.abs(nose.x - chin.x), chin.y - nose.y) * 180 / Math.PI;
  if (headAngle > 20) score -= 15;

  const earY = (lEar.y + rEar.y) / 2;
  const noseDrop = nose.y - earY;
  if (noseDrop > 0.08) score -= 10;

  const noseOffset = Math.abs(nose.x - 0.5);
  if (noseOffset > 0.1) score -= 10;

  return Math.max(0, score);
}

function analyzeEyeContact(landmarks) {
  const lIris = landmarks[468], rIris = landmarks[473];
  const lEyeInner = landmarks[133], lEyeOuter = landmarks[33];
  const rEyeInner = landmarks[263], rEyeOuter = landmarks[362];

  const lEyeWidth = Math.hypot(lEyeInner.x - lEyeOuter.x, lEyeInner.y - lEyeOuter.y);
  const rEyeWidth = Math.hypot(rEyeInner.x - rEyeOuter.x, rEyeInner.y - rEyeOuter.y);

  if (lEyeWidth < 0.01 || rEyeWidth < 0.01) return false;

  const lIrisOffset = Math.hypot(
    (lIris.x - (lEyeInner.x + lEyeOuter.x) / 2) / lEyeWidth,
    (lIris.y - (lEyeInner.y + lEyeOuter.y) / 2) / lEyeWidth
  );
  const rIrisOffset = Math.hypot(
    (rIris.x - (rEyeInner.x + rEyeOuter.x) / 2) / rEyeWidth,
    (rIris.y - (rEyeInner.y + rEyeOuter.y) / 2) / rEyeWidth
  );

  return lIrisOffset < 0.3 && rIrisOffset < 0.3;
}

function analyzeExpression(landmarks) {
  const lCorner = landmarks[61], rCorner = landmarks[291];
  const mouthCenter = landmarks[13];
  const lSmile = mouthCenter.y - lCorner.y;
  const rSmile = mouthCenter.y - rCorner.y;
  const avgSmile = (lSmile + rSmile) / 2;
  return avgSmile > 0.02;
}

function analyzeMouthOpenness(landmarks) {
  const upperLip = landmarks[13], lowerLip = landmarks[14];
  const distance = Math.hypot(upperLip.x - lowerLip.x, upperLip.y - lowerLip.y);
  sessionState.mouthOpennessValues.push(distance);
}

function analyzeBlink(landmarks) {
  const upper = landmarks[159], lower = landmarks[145];
  const eyeOpenDist = Math.hypot(upper.x - lower.x, upper.y - lower.y);
  const currentClosed = eyeOpenDist < 0.015;
  if (sessionState.lastBlinkState === false && currentClosed === true) {
    sessionState.blinkCount++;
  }
  sessionState.lastBlinkState = currentClosed;
}

function analyzeEyebrowRaise(landmarks) {
  const lBrow = landmarks[105], lEye = landmarks[159];
  const rBrow = landmarks[334], rEye = landmarks[386];
  const lDist = lEye.y - lBrow.y;
  const rDist = rEye.y - rBrow.y;
  const avgDist = (lDist + rDist) / 2;
  if (sessionState.baselineBrowY === null) {
    sessionState.baselineBrowY = avgDist;
  } else {
    sessionState.baselineBrowY = sessionState.baselineBrowY * 0.95 + avgDist * 0.05;
  }
  if (avgDist > sessionState.baselineBrowY * 1.3) {
    sessionState.eyebrowRaiseCount++;
  }
}

let feedbackInProgress = false;

document.getElementById('getFeedbackBtn').addEventListener('click', async () => {
  if (feedbackInProgress) return;
  feedbackInProgress = true;
  const btn = document.getElementById('getFeedbackBtn');
  btn.textContent = '⏳ Processing...';
  btn.disabled = true;
  sessionState.sessionActive = false;
  sessionState.stopLoop = true;
  if (sessionState.recognition) {
    try { sessionState.recognition.stop(); } catch (e) {}
  }
  if (sessionState.mediaRecorder && sessionState.mediaRecorder.state !== 'inactive') {
    await Promise.race([
      new Promise(resolve => { sessionState.mediaRecorder.onstop = resolve; sessionState.mediaRecorder.stop(); }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('onstop timeout')), 5000))
    ]).catch(() => {});
  }
  clearInterval(sessionState.paceInterval);
  clearInterval(sessionState.timerInterval);
  stopStream();

  try {
    await transcribeAndProcess();
    sessionState.audioChunks = [];

    const seconds = sessionState.startTime ? Math.round((Date.now() - sessionState.startTime) / 1000) : 0;
    const minutes = sessionState.startTime ? (Date.now() - sessionState.startTime) / 60000 : 0;
    const avgPosture = sessionState.postureScores.length > 0
      ? Math.round(sessionState.postureScores.reduce((a, b) => a + b, 0) / sessionState.postureScores.length)
      : 0;

    const eyeContactPct = sessionState.totalFrames > 0
      ? Math.round((sessionState.eyeContactFrames / sessionState.totalFrames) * 100) : 0;
    const smilePct = sessionState.totalFrames > 0
      ? Math.round((sessionState.smileFrames / sessionState.totalFrames) * 100) : 0;
    const blinksPerMin = minutes > 0
      ? Math.round(sessionState.blinkCount / minutes) : 0;
    const avgMouthOpen = sessionState.mouthOpennessValues.length > 0
      ? parseFloat((sessionState.mouthOpennessValues.reduce((a, b) => a + b, 0) / sessionState.mouthOpennessValues.length * 1000).toFixed(1)) : 0;

    console.log('=== FEEDBACK DATA ===');
    console.log('transcript:', sessionState.transcript);
    console.log('wordCount:', sessionState.wordCount);
    console.log('minutes:', minutes);
    console.log('pace:', minutes > 0 ? Math.round(sessionState.wordCount / minutes) : 0);
    console.log('fillerCount:', sessionState.fillerCount);
    console.log('headPositionScore:', avgPosture);
    console.log('eyeContact%:', eyeContactPct);
    console.log('smile%:', smilePct);
    console.log('blinks/min:', blinksPerMin);
    console.log('mouthOpenness:', avgMouthOpen);
    console.log('duration sec:', seconds);

    if (seconds < 15) {
      sessionState.coachingTips.push('Please speak for at least 15 seconds before our agents can analyze your presentation and give you feedback.');
    } else {
      try {
        const res = await fetchWithTimeout('/api/coach/', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-CSRFToken': getCSRF()
          },
          body: JSON.stringify({
            transcript: sessionState.transcript,
            filler_count: sessionState.fillerCount,
            pace: minutes > 0 ? Math.round(sessionState.wordCount / minutes) : 0,
            posture_score: avgPosture,
            eye_contact: eyeContactPct,
            expression: smilePct,
            blink_rate: blinksPerMin,
            mouth_openness: avgMouthOpen
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error('Coach API error:', res.status, errData);
        } else {
          const data = await res.json();
          if (data.tip) {
            sessionState.coachingTips.push(data.tip);
            const utterance = new SpeechSynthesisUtterance(data.tip);
            speechSynthesis.speak(utterance);
          }
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
      smileScore: smilePct,
      blinkRate: blinksPerMin,
      mouthOpenness: avgMouthOpen,
      postureScores: sessionState.postureScores,
      tips: sessionState.coachingTips,
      transcript: sessionState.transcript
    };
    try {
      const res = await fetchWithTimeout('/api/save-session/', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRFToken': getCSRF()
        },
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
  } catch (e) {
    console.error('getFeedback error:', e);
    btn.textContent = 'Get Feedback';
    btn.disabled = false;
  }
  feedbackInProgress = false;
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
