const firebaseConfig = window.__ENV__?.FIREBASE_CONFIG || window.__STATIC_ENV__?.FIREBASE_CONFIG;

if (!firebaseConfig) {
  throw new Error("Missing Firebase config. Add a deployed firebase config or start the app through the local server.");
}

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

const refs = {
  publicView: document.getElementById("public-view"),
  adminSection: document.getElementById("admin-section"),
  form: document.getElementById("message-form"),
  messageInput: document.getElementById("message"),
  charCount: document.getElementById("char-count"),
  imageInput: document.getElementById("image-upload"),
  imageStatus: document.getElementById("image-status"),
  clearImageButton: document.getElementById("clear-image-button"),
  imageControls: document.getElementById("image-controls"),
  clearAudioButton: document.getElementById("clear-audio-button"),
  startRecordingButton: document.getElementById("start-recording-button"),
  stopRecordingButton: document.getElementById("stop-recording-button"),
  voiceStatus: document.getElementById("voice-status"),
  voicePreview: document.getElementById("voice-preview"),
  voiceEffect: document.getElementById("voice-effect"),
  maskStrength: document.getElementById("mask-strength"),
  maskStrengthValue: document.getElementById("mask-strength-value"),
  textPosition: document.getElementById("text-position"),
  textSize: document.getElementById("text-size"),
  textSizeValue: document.getElementById("text-size-value"),
  previewCard: document.getElementById("preview-card"),
  previewPlaceholder: document.getElementById("preview-placeholder"),
  previewImage: document.getElementById("preview-image"),
  previewOverlay: document.getElementById("preview-overlay"),
  submitButton: document.getElementById("submit-button"),
  submitLabel: document.getElementById("submit-label"),
  successMessage: document.getElementById("success-message"),
  messageCount: document.getElementById("message-count"),
  logoutButton: document.getElementById("logout-button"),
  adminLoading: document.getElementById("admin-loading"),
  adminEmpty: document.getElementById("admin-empty"),
  messagesList: document.getElementById("messages-list"),
  backToFormLink: document.getElementById("back-to-form-link"),
  floatingWords: document.getElementById("floating-words"),
};

const state = {
  isAdminMode: false,
  isSending: false,
  isLoadingMessages: false,
  isPreparingImage: false,
  adminUser: null,
  messages: [],
  floatingWord: "cheteee🙌",
  selectedImageDataUrl: "",
  selectedImageName: "",
  recordedAudioDataUrl: "",
  recordedAudioDurationSeconds: 0,
  recordedAudioEffect: "anonymous",
  recordedAudioMaskStrength: 70,
  isRecordingAudio: false,
  isPreparingAudio: false,
  mediaRecorder: null,
  mediaStream: null,
  audioContext: null,
  audioEffectCleanup: null,
};

let authUnsubscribe = null;
let messagesUnsubscribe = null;
let floatingInterval = null;
let successTimeout = null;
let recordingTimeout = null;
let recordingInterval = null;
let recordingStartTime = 0;
let audioChunks = [];

const MAX_AUDIO_BYTES = 350 * 1024;
const MAX_AUDIO_RECORDING_MS = 20 * 1000;
const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
const MASK_STRENGTH_MIN = 20;
const MASK_STRENGTH_MAX = 100;
const DEFAULT_MASK_STRENGTH = 70;
const DEFAULT_TEXT_SIZE = 20;

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function setFloatingWord(word) {
  state.floatingWord = word;
}

function spawnFloatingWord() {
  const wordEl = document.createElement("span");
  const id = crypto?.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());

  wordEl.dataset.id = id;
  wordEl.className = "floating-word";
  wordEl.textContent = state.floatingWord;
  wordEl.style.left = `${Math.random() * 100}%`;
  wordEl.style.top = `${Math.random() * 100}%`;
  wordEl.style.fontSize = `${rand(10, 18)}px`;
  wordEl.style.setProperty("--dur", `${rand(4, 8)}s`);
  wordEl.style.setProperty("--xStart", `${rand(-40, 40)}px`);
  wordEl.style.setProperty("--yStart", `${rand(-40, 40)}px`);
  wordEl.style.setProperty("--xMid", `${rand(-120, 120)}px`);
  wordEl.style.setProperty("--yMid", `${rand(-120, 120)}px`);
  wordEl.style.setProperty("--xEnd", `${rand(-220, 220)}px`);
  wordEl.style.setProperty("--yEnd", `${rand(-220, 220)}px`);

  refs.floatingWords.prepend(wordEl);

  while (refs.floatingWords.children.length > 25) {
    refs.floatingWords.lastElementChild.remove();
  }

  window.setTimeout(() => {
    wordEl.remove();
  }, 9000);
}

function startFloatingWords() {
  if (floatingInterval) {
    return;
  }

  floatingInterval = window.setInterval(spawnFloatingWord, 900);
  for (let i = 0; i < 6; i += 1) {
    window.setTimeout(spawnFloatingWord, i * 180);
  }
}

function stopFloatingWords() {
  if (!floatingInterval) {
    refs.floatingWords.replaceChildren();
    return;
  }

  window.clearInterval(floatingInterval);
  floatingInterval = null;
  refs.floatingWords.replaceChildren();
}

function browserSupportsVoiceRecording() {
  return Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function getVoiceEffectLabel(effect) {
  switch (effect) {
    case "extreme":
      return "Extreme Anonymous";
    case "robot":
      return "Robot";
    case "deep":
      return "Deep Voice";
    case "anonymous":
    default:
      return "Anonymous";
  }
}

function getMaskStrengthValue() {
  return Number(refs.maskStrength.value) || DEFAULT_MASK_STRENGTH;
}

function getNormalizedMaskStrength(strengthValue) {
  const clampedValue = Math.min(
    MASK_STRENGTH_MAX,
    Math.max(MASK_STRENGTH_MIN, Number(strengthValue) || DEFAULT_MASK_STRENGTH)
  );

  return (clampedValue - MASK_STRENGTH_MIN) / (MASK_STRENGTH_MAX - MASK_STRENGTH_MIN);
}

function scaleByStrength(min, max, normalizedStrength) {
  return min + (max - min) * normalizedStrength;
}

function hasComposerContent() {
  return (
    refs.messageInput.value.trim().length > 0 ||
    Boolean(state.selectedImageDataUrl) ||
    Boolean(state.recordedAudioDataUrl)
  );
}

function hasPendingVoiceSettingsChange() {
  return (
    Boolean(state.recordedAudioDataUrl) &&
    (
      refs.voiceEffect.value !== state.recordedAudioEffect ||
      getMaskStrengthValue() !== state.recordedAudioMaskStrength
    )
  );
}

function syncSubmitState() {
  refs.submitButton.disabled =
    state.isSending ||
    state.isPreparingImage ||
    state.isRecordingAudio ||
    state.isPreparingAudio ||
    hasPendingVoiceSettingsChange() ||
    !hasComposerContent();
  refs.submitButton.classList.toggle("is-ready", !refs.submitButton.disabled);
}

function setSubmitState(isSending) {
  state.isSending = isSending;
  refs.submitButton.classList.toggle("loading", isSending);
  refs.submitLabel.textContent = isSending ? "Sending..." : "Send Message";
  syncSubmitState();
}

function updateCharCount() {
  refs.charCount.textContent = `${refs.messageInput.value.length} / 500`;
  syncSubmitState();
}

function showSuccessMessage() {
  refs.successMessage.hidden = false;
  window.clearTimeout(successTimeout);
  successTimeout = window.setTimeout(() => {
    refs.successMessage.hidden = true;
  }, 3000);
}

function clearRecordingTimers() {
  window.clearTimeout(recordingTimeout);
  window.clearInterval(recordingInterval);
  recordingTimeout = null;
  recordingInterval = null;
}

function stopAudioStream() {
  if (!state.mediaStream) {
    return;
  }

  state.mediaStream.getTracks().forEach((track) => track.stop());
  state.mediaStream = null;
}

function cleanupVoiceProcessing() {
  if (typeof state.audioEffectCleanup === "function") {
    state.audioEffectCleanup();
  }

  state.audioEffectCleanup = null;

  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
    state.audioContext = null;
  }
}

function updateVoiceRecorderUI() {
  const supportsVoiceRecording = browserSupportsVoiceRecording();
  const hasAudio = Boolean(state.recordedAudioDataUrl);
  const hasImage = Boolean(state.selectedImageDataUrl);
  const selectedEffect = refs.voiceEffect.value;
  const selectedStrength = getMaskStrengthValue();
  const recordedEffectLabel = getVoiceEffectLabel(state.recordedAudioEffect);
  const selectedEffectLabel = getVoiceEffectLabel(selectedEffect);
  const recordedStrength = state.recordedAudioMaskStrength;

  refs.maskStrengthValue.textContent = `${selectedStrength}%`;
  refs.startRecordingButton.hidden = state.isRecordingAudio;
  refs.stopRecordingButton.hidden = !state.isRecordingAudio;
  refs.clearAudioButton.hidden = !hasAudio || state.isRecordingAudio || state.isPreparingAudio;
  refs.voiceEffect.disabled = !supportsVoiceRecording || state.isRecordingAudio || state.isPreparingAudio;
  refs.maskStrength.disabled = !supportsVoiceRecording || state.isRecordingAudio || state.isPreparingAudio;
  refs.startRecordingButton.disabled =
    !supportsVoiceRecording || hasImage || state.isSending || state.isPreparingAudio;
  refs.stopRecordingButton.disabled = state.isPreparingAudio || !state.isRecordingAudio;
  refs.voicePreview.hidden = !hasAudio;

  if (hasAudio && refs.voicePreview.src !== state.recordedAudioDataUrl) {
    refs.voicePreview.src = state.recordedAudioDataUrl;
  }

  if (!hasAudio) {
    refs.voicePreview.pause();
    refs.voicePreview.removeAttribute("src");
  }

  if (!supportsVoiceRecording) {
    refs.voiceStatus.textContent = "Voice recording is not supported in this browser.";
    return;
  }

  if (state.isPreparingAudio) {
    refs.voiceStatus.textContent = "Preparing your voice note...";
    return;
  }

  if (state.isRecordingAudio) {
    const elapsedMs = Date.now() - recordingStartTime;
    const elapsedSeconds = Math.max(1, Math.ceil(elapsedMs / 1000));
    refs.voiceStatus.textContent =
      `Recording with ${selectedEffectLabel} at ${selectedStrength}%... ${elapsedSeconds}s / ${MAX_AUDIO_RECORDING_MS / 1000}s`;
    return;
  }

  if (hasImage) {
    refs.voiceStatus.textContent =
      "Remove the picture first to record a voice note. This version supports one media type per message.";
    return;
  }

  if (hasAudio) {
    if (
      selectedEffect !== state.recordedAudioEffect ||
      selectedStrength !== recordedStrength
    ) {
      refs.voiceStatus.textContent =
        `Current voice note uses ${recordedEffectLabel} at ${recordedStrength}%. Record again to apply ${selectedEffectLabel} at ${selectedStrength}%.`;
      return;
    }

    refs.voiceStatus.textContent =
      `Voice note ready (${formatDuration(state.recordedAudioDurationSeconds)}) with ${recordedEffectLabel} at ${recordedStrength}%.`;
    return;
  }

  refs.voiceStatus.textContent =
    `Record a voice note up to 20 seconds. ${selectedEffectLabel} at ${selectedStrength}% selected.`;
}

function updatePreview() {
  const hasImage = Boolean(state.selectedImageDataUrl);
  const messageText = refs.messageInput.value.trim();

  refs.textSizeValue.textContent = `${refs.textSize.value}px`;
  refs.imageControls.setAttribute("aria-disabled", String(!hasImage));
  refs.imageControls.classList.toggle("is-disabled", !hasImage);
  refs.clearImageButton.hidden = !hasImage;
  refs.previewCard.classList.toggle("has-image", hasImage);
  refs.previewPlaceholder.hidden = hasImage;
  refs.previewImage.hidden = !hasImage;
  refs.previewOverlay.hidden = !hasImage;

  if (!hasImage) {
    refs.previewImage.removeAttribute("src");
    refs.previewPlaceholder.textContent = "Add a photo and preview your message on it.";
    refs.previewOverlay.textContent = "";
    refs.previewOverlay.className = "preview-overlay is-bottom";
    refs.imageStatus.textContent =
      "Add a photo and preview your message on it.";
    updateVoiceRecorderUI();
    return;
  }

  if (refs.previewImage.src !== state.selectedImageDataUrl) {
    refs.previewImage.src = state.selectedImageDataUrl;
  }
  refs.previewOverlay.textContent = messageText || "Your message appears here";
  refs.previewOverlay.style.fontSize = `${refs.textSize.value}px`;
  refs.previewOverlay.className = `preview-overlay is-${refs.textPosition.value}`;
  refs.imageStatus.textContent = `${state.selectedImageName} is ready. Your message will be placed ${refs.textPosition.value}.`;
  updateVoiceRecorderUI();
}

function resetComposer() {
  revokeSelectedImageUrl();
  refs.messageInput.value = "";
  refs.imageInput.value = "";
  refs.textPosition.value = "bottom";
  refs.textSize.value = String(DEFAULT_TEXT_SIZE);
  refs.voiceEffect.value = "anonymous";
  refs.maskStrength.value = String(DEFAULT_MASK_STRENGTH);
  state.isPreparingImage = false;
  state.selectedImageDataUrl = "";
  state.selectedImageName = "";
  clearRecordedAudio();
  updateCharCount();
  updatePreview();
}

function revokeSelectedImageUrl() {
  if (state.selectedImageDataUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.selectedImageDataUrl);
  }
}

function clearSelectedImage() {
  revokeSelectedImageUrl();
  refs.imageInput.value = "";
  state.isPreparingImage = false;
  state.selectedImageDataUrl = "";
  state.selectedImageName = "";
  syncSubmitState();
  updatePreview();
}

function clearRecordedAudio() {
  refs.voicePreview.pause();
  refs.voicePreview.removeAttribute("src");
  refs.voicePreview.load();
  state.recordedAudioDataUrl = "";
  state.recordedAudioDurationSeconds = 0;
  state.recordedAudioEffect = refs.voiceEffect.value;
  state.recordedAudioMaskStrength = getMaskStrengthValue();
  audioChunks = [];
  syncSubmitState();
  updateVoiceRecorderUI();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Could not read the selected file."));

    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the selected image."));
    image.src = src;
  });
}

function buildPreviewImageSource(file) {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return Promise.resolve(URL.createObjectURL(file));
  }

  return readFileAsDataUrl(file);
}

function getImageSelectionErrorMessage(file, error) {
  if (/image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
    return "This phone photo format is not supported by this browser. Please use a JPG or PNG image.";
  }

  return error.message || "Could not load the selected image.";
}

function drawImageToCanvas(image, maxDimension) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare the image for upload.");
  }

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function estimateDataUrlBytes(dataUrl) {
  const [, base64 = ""] = dataUrl.split(",");
  const paddingMatch = base64.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;
  return Math.ceil((base64.length * 3) / 4) - paddingLength;
}

function getSupportedAudioMimeType() {
  const mimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  if (typeof window.MediaRecorder?.isTypeSupported !== "function") {
    return "";
  }

  return mimeTypes.find((type) => window.MediaRecorder.isTypeSupported(type)) || "";
}

function createAudioRecorder(stream) {
  const mimeType = getSupportedAudioMimeType();

  if (!mimeType) {
    return new MediaRecorder(stream);
  }

  return new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond: 24000,
  });
}

function createDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const k = typeof amount === "number" ? amount : 0;
  const deg = Math.PI / 180;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }

  return curve;
}

function addOscillatorModulator(audioContext, cleanupFns, { type, frequency, depth, target }) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gainNode.gain.value = depth;

  oscillator.connect(gainNode);
  gainNode.connect(target);
  oscillator.start();

  cleanupFns.push(() => {
    try {
      oscillator.stop();
    } catch (error) {
      // ignore stop errors during cleanup
    }
    oscillator.disconnect();
    gainNode.disconnect();
  });
}

async function buildProcessedAudioStream(stream, effectName, maskStrengthValue) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    return {
      processedStream: stream,
      audioContext: null,
      cleanup: null,
    };
  }

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const destination = audioContext.createMediaStreamDestination();
  const cleanupFns = [];
  const normalizedStrength = getNormalizedMaskStrength(maskStrengthValue);

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = scaleByStrength(-24, -34, normalizedStrength);
  compressor.knee.value = scaleByStrength(22, 12, normalizedStrength);
  compressor.ratio.value = scaleByStrength(8, 14, normalizedStrength);
  compressor.attack.value = scaleByStrength(0.008, 0.002, normalizedStrength);
  compressor.release.value = scaleByStrength(0.24, 0.14, normalizedStrength);

  await audioContext.resume();

  if (effectName === "robot") {
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = scaleByStrength(180, 320, normalizedStrength);
    highpass.Q.value = scaleByStrength(0.65, 1.05, normalizedStrength);

    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = scaleByStrength(900, 680, normalizedStrength);
    bandpass.Q.value = scaleByStrength(0.95, 1.8, normalizedStrength);

    const highshelf = audioContext.createBiquadFilter();
    highshelf.type = "highshelf";
    highshelf.frequency.value = scaleByStrength(2600, 1800, normalizedStrength);
    highshelf.gain.value = scaleByStrength(-4, -14, normalizedStrength);

    const distortion = audioContext.createWaveShaper();
    distortion.curve = createDistortionCurve(scaleByStrength(18, 60, normalizedStrength));
    distortion.oversample = "4x";

    const gainNode = audioContext.createGain();
    gainNode.gain.value = scaleByStrength(0.68, 0.42, normalizedStrength);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(highshelf);
    highshelf.connect(distortion);
    distortion.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(destination);

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "square",
      frequency: 52,
      depth: scaleByStrength(0.14, 0.52, normalizedStrength),
      target: gainNode.gain,
    });

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "sawtooth",
      frequency: 96,
      depth: scaleByStrength(40, 190, normalizedStrength),
      target: bandpass.frequency,
    });
  } else if (effectName === "deep") {
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = scaleByStrength(60, 160, normalizedStrength);
    highpass.Q.value = scaleByStrength(0.55, 0.85, normalizedStrength);

    const lowShelf = audioContext.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = scaleByStrength(220, 160, normalizedStrength);
    lowShelf.gain.value = scaleByStrength(8, 22, normalizedStrength);

    const peaking = audioContext.createBiquadFilter();
    peaking.type = "peaking";
    peaking.frequency.value = scaleByStrength(360, 260, normalizedStrength);
    peaking.Q.value = scaleByStrength(0.85, 1.25, normalizedStrength);
    peaking.gain.value = scaleByStrength(3, 11, normalizedStrength);

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = scaleByStrength(1800, 1050, normalizedStrength);
    lowpass.Q.value = scaleByStrength(0.7, 1.0, normalizedStrength);

    const highshelf = audioContext.createBiquadFilter();
    highshelf.type = "highshelf";
    highshelf.frequency.value = scaleByStrength(2200, 1600, normalizedStrength);
    highshelf.gain.value = scaleByStrength(-6, -18, normalizedStrength);

    const distortion = audioContext.createWaveShaper();
    distortion.curve = createDistortionCurve(scaleByStrength(4, 18, normalizedStrength));
    distortion.oversample = "4x";

    const gainNode = audioContext.createGain();
    gainNode.gain.value = scaleByStrength(0.94, 0.74, normalizedStrength);

    source.connect(highpass);
    highpass.connect(lowShelf);
    lowShelf.connect(peaking);
    peaking.connect(lowpass);
    lowpass.connect(highshelf);
    highshelf.connect(distortion);
    distortion.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(destination);

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "sine",
      frequency: 3.2,
      depth: scaleByStrength(18, 80, normalizedStrength),
      target: lowpass.frequency,
    });
  } else if (effectName === "extreme") {
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = scaleByStrength(420, 620, normalizedStrength);
    highpass.Q.value = scaleByStrength(0.9, 1.25, normalizedStrength);

    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = scaleByStrength(860, 700, normalizedStrength);
    bandpass.Q.value = scaleByStrength(1.2, 1.8, normalizedStrength);

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = scaleByStrength(1320, 1020, normalizedStrength);
    lowpass.Q.value = scaleByStrength(0.9, 1.15, normalizedStrength);

    const notch = audioContext.createBiquadFilter();
    notch.type = "notch";
    notch.frequency.value = scaleByStrength(980, 820, normalizedStrength);
    notch.Q.value = scaleByStrength(1.0, 1.6, normalizedStrength);

    const highshelf = audioContext.createBiquadFilter();
    highshelf.type = "highshelf";
    highshelf.frequency.value = scaleByStrength(1550, 1250, normalizedStrength);
    highshelf.gain.value = scaleByStrength(-12, -24, normalizedStrength);

    const distortionA = audioContext.createWaveShaper();
    distortionA.curve = createDistortionCurve(scaleByStrength(55, 110, normalizedStrength));
    distortionA.oversample = "4x";

    const distortionB = audioContext.createWaveShaper();
    distortionB.curve = createDistortionCurve(scaleByStrength(20, 44, normalizedStrength));
    distortionB.oversample = "4x";

    const gainNode = audioContext.createGain();
    gainNode.gain.value = scaleByStrength(0.58, 0.36, normalizedStrength);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(notch);
    notch.connect(lowpass);
    lowpass.connect(distortionA);
    distortionA.connect(highshelf);
    highshelf.connect(distortionB);
    distortionB.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(destination);

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "square",
      frequency: 27,
      depth: scaleByStrength(0.1, 0.3, normalizedStrength),
      target: gainNode.gain,
    });

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "sine",
      frequency: 82,
      depth: scaleByStrength(100, 220, normalizedStrength),
      target: bandpass.frequency,
    });

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "triangle",
      frequency: 11,
      depth: scaleByStrength(50, 130, normalizedStrength),
      target: lowpass.frequency,
    });

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "sawtooth",
      frequency: 6,
      depth: scaleByStrength(70, 150, normalizedStrength),
      target: notch.frequency,
    });
  } else {
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = scaleByStrength(300, 500, normalizedStrength);
    highpass.Q.value = scaleByStrength(0.7, 1.05, normalizedStrength);

    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = scaleByStrength(960, 760, normalizedStrength);
    bandpass.Q.value = scaleByStrength(0.85, 1.35, normalizedStrength);

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = scaleByStrength(1700, 1250, normalizedStrength);
    lowpass.Q.value = scaleByStrength(0.8, 1.05, normalizedStrength);

    const highshelf = audioContext.createBiquadFilter();
    highshelf.type = "highshelf";
    highshelf.frequency.value = scaleByStrength(1800, 1400, normalizedStrength);
    highshelf.gain.value = scaleByStrength(-8, -22, normalizedStrength);

    const notch = audioContext.createBiquadFilter();
    notch.type = "notch";
    notch.frequency.value = scaleByStrength(1080, 1280, normalizedStrength);
    notch.Q.value = scaleByStrength(0.7, 1.5, normalizedStrength);

    const distortion = audioContext.createWaveShaper();
    distortion.curve = createDistortionCurve(scaleByStrength(24, 72, normalizedStrength));
    distortion.oversample = "4x";

    const gainNode = audioContext.createGain();
    gainNode.gain.value = scaleByStrength(0.7, 0.46, normalizedStrength);

    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(notch);
    notch.connect(lowpass);
    lowpass.connect(distortion);
    distortion.connect(highshelf);
    highshelf.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(destination);

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "triangle",
      frequency: 18,
      depth: scaleByStrength(0.08, 0.28, normalizedStrength),
      target: gainNode.gain,
    });

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "sine",
      frequency: 66,
      depth: scaleByStrength(60, 170, normalizedStrength),
      target: bandpass.frequency,
    });

    addOscillatorModulator(audioContext, cleanupFns, {
      type: "sawtooth",
      frequency: 7,
      depth: scaleByStrength(24, 95, normalizedStrength),
      target: lowpass.frequency,
    });
  }

  return {
    processedStream: destination.stream,
    audioContext,
    cleanup() {
      cleanupFns.forEach((cleanupFn) => cleanupFn());
    },
  };
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function wrapCanvasLine(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  if (!words.length) {
    return [""];
  }

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (!currentLine || ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);

    if (ctx.measureText(word).width <= maxWidth) {
      currentLine = word;
      continue;
    }

    let slice = "";
    for (const char of word) {
      const charCandidate = `${slice}${char}`;
      if (!slice || ctx.measureText(charCandidate).width <= maxWidth) {
        slice = charCandidate;
      } else {
        lines.push(slice);
        slice = char;
      }
    }
    currentLine = slice;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const paragraphs = text.split("\n");
  const lines = [];

  for (const paragraph of paragraphs) {
    const paragraphLines = wrapCanvasLine(ctx, paragraph, maxWidth);
    lines.push(...paragraphLines);
  }

  return lines;
}

function getScaledFontSize(width, height, requestedSize) {
  const baseSize = Number(requestedSize) || DEFAULT_TEXT_SIZE;
  const referenceSize = Math.min(width, height) / 520;
  return Math.max(DEFAULT_TEXT_SIZE, Math.round(baseSize * Math.max(referenceSize, 1)));
}

function drawOverlayText(ctx, width, height, text, position, requestedSize) {
  if (!text.trim()) {
    return;
  }

  const boxWidth = Math.round(width * 0.84);
  const boxX = Math.round((width - boxWidth) / 2);
  let fontSize = getScaledFontSize(width, height, requestedSize);
  let lineHeight = Math.round(fontSize * 1.22);
  let lines = [];

  for (let attempts = 0; attempts < 8; attempts += 1) {
    ctx.font = `700 ${fontSize}px "DM Sans", sans-serif`;
    lines = wrapCanvasText(ctx, text, boxWidth - Math.round(fontSize * 1.1));

    if (lines.length <= 6 || fontSize <= 26) {
      break;
    }

    fontSize -= 4;
    lineHeight = Math.round(fontSize * 1.22);
  }

  const paddingY = Math.round(fontSize * 0.45);
  const boxHeight = Math.round(lines.length * lineHeight + paddingY * 2);
  const verticalInset = Math.round(height * 0.08);

  let boxY = Math.round((height - boxHeight) / 2);
  if (position === "top") {
    boxY = verticalInset;
  }
  if (position === "bottom") {
    boxY = height - boxHeight - verticalInset;
  }

  ctx.save();
  ctx.fillStyle = "rgba(7, 9, 19, 0.16)";
  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, Math.round(fontSize * 0.5));
  ctx.fill();

  ctx.font = `700 ${fontSize}px "DM Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.lineWidth = Math.max(4, Math.round(fontSize * 0.16));
  ctx.fillStyle = "#f4f6ff";

  lines.forEach((line, index) => {
    const y = boxY + paddingY + index * lineHeight;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });

  ctx.restore();
}

function resizeCanvas(sourceCanvas, scaleFactor) {
  const resizedCanvas = document.createElement("canvas");
  resizedCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scaleFactor));
  resizedCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scaleFactor));

  const resizedContext = resizedCanvas.getContext("2d");
  if (!resizedContext) {
    throw new Error("Could not prepare the image for upload.");
  }

  resizedContext.drawImage(sourceCanvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
  return resizedCanvas;
}

function canvasToCompressedDataUrl(canvas) {
  const maxBytes = 700 * 1024;
  let workingCanvas = canvas;

  for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
    for (let quality = 0.82; quality >= 0.42; quality -= 0.08) {
      const dataUrl = workingCanvas.toDataURL("image/jpeg", Number(quality.toFixed(2)));
      if (estimateDataUrlBytes(dataUrl) <= maxBytes) {
        return dataUrl;
      }
    }

    workingCanvas = resizeCanvas(workingCanvas, 0.85);
  }

  throw new Error("This picture is too large to send. Try a smaller image.");
}

async function buildPhotoMessageDataUrl() {
  if (!state.selectedImageDataUrl) {
    return "";
  }

  const image = await loadImage(state.selectedImageDataUrl);
  const canvas = drawImageToCanvas(image, 1080);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare the image for upload.");
  }

  drawOverlayText(
    ctx,
    canvas.width,
    canvas.height,
    refs.messageInput.value.trim(),
    refs.textPosition.value,
    refs.textSize.value
  );

  return canvasToCompressedDataUrl(canvas);
}

async function startVoiceRecording() {
  if (!browserSupportsVoiceRecording()) {
    alert("Voice recording is not supported in this browser.");
    return;
  }

  if (state.selectedImageDataUrl) {
    alert("Remove the picture first. This version supports either one picture or one voice note per message.");
    return;
  }

  if (state.isRecordingAudio || state.isPreparingAudio) {
    return;
  }

  try {
    const selectedEffect = refs.voiceEffect.value;
    const selectedMaskStrength = getMaskStrengthValue();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const { processedStream, audioContext, cleanup } = await buildProcessedAudioStream(
      stream,
      selectedEffect,
      selectedMaskStrength
    );
    const recorder = createAudioRecorder(processedStream);

    if (state.recordedAudioDataUrl) {
      clearRecordedAudio();
    }

    state.mediaStream = stream;
    state.mediaRecorder = recorder;
    state.audioContext = audioContext;
    state.audioEffectCleanup = cleanup;
    state.isRecordingAudio = true;
    state.isPreparingAudio = false;
    audioChunks = [];
    recordingStartTime = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      clearRecordingTimers();
      cleanupVoiceProcessing();
      stopAudioStream();
      state.mediaRecorder = null;
      state.isRecordingAudio = false;
      state.isPreparingAudio = false;
      audioChunks = [];
      syncSubmitState();
      updateVoiceRecorderUI();
      alert("Could not record audio. Please try again.");
    };

    recorder.onstop = async () => {
      const durationMs = Math.min(Date.now() - recordingStartTime, MAX_AUDIO_RECORDING_MS);
      const durationSeconds = Math.max(1, Math.round(durationMs / 1000));

      clearRecordingTimers();
      cleanupVoiceProcessing();
      stopAudioStream();
      state.mediaRecorder = null;
      state.isRecordingAudio = false;
      state.isPreparingAudio = true;
      updateVoiceRecorderUI();
      syncSubmitState();

      try {
        const mimeType = audioChunks[0]?.type || getSupportedAudioMimeType() || "audio/webm";
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];

        if (!audioBlob.size) {
          throw new Error("No audio was captured. Please try again.");
        }

        if (audioBlob.size > MAX_AUDIO_BYTES) {
          throw new Error("Voice note is too large. Please keep it shorter than 20 seconds.");
        }

        const audioDataUrl = await readFileAsDataUrl(audioBlob);

        if (estimateDataUrlBytes(audioDataUrl) > MAX_AUDIO_BYTES) {
          throw new Error("Voice note is too large. Please keep it shorter than 20 seconds.");
        }

        state.recordedAudioDataUrl = audioDataUrl;
        state.recordedAudioDurationSeconds = durationSeconds;
        state.recordedAudioEffect = selectedEffect;
        state.recordedAudioMaskStrength = selectedMaskStrength;
      } catch (error) {
        clearRecordedAudio();
        alert(error.message);
      } finally {
        state.isPreparingAudio = false;
        syncSubmitState();
        updateVoiceRecorderUI();
      }
    };

    recorder.start();
    updateVoiceRecorderUI();
    syncSubmitState();

    recordingInterval = window.setInterval(updateVoiceRecorderUI, 250);
    recordingTimeout = window.setTimeout(() => {
      stopVoiceRecording();
    }, MAX_AUDIO_RECORDING_MS);
  } catch (error) {
    clearRecordingTimers();
    cleanupVoiceProcessing();
    stopAudioStream();
    state.mediaRecorder = null;
    state.isRecordingAudio = false;
    state.isPreparingAudio = false;
    audioChunks = [];
    syncSubmitState();
    updateVoiceRecorderUI();
    alert(`Microphone access failed: ${error.message}`);
  }
}

function stopVoiceRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state !== "recording") {
    return;
  }

  refs.voiceStatus.textContent = "Finishing your voice note...";
  state.mediaRecorder.stop();
}

function createMessageElement(message, index) {
  const item = document.createElement("div");
  item.className = "message-item";
  item.style.animationDelay = `${index * 0.1}s`;

  if (message.imageDataUrl) {
    const media = document.createElement("div");
    media.className = "message-media";

    const image = document.createElement("img");
    image.src = message.imageDataUrl;
    image.alt = "Anonymous photo message";
    image.loading = "lazy";

    media.appendChild(image);
    item.appendChild(media);
  }

  if (message.audioDataUrl) {
    const audioWrap = document.createElement("div");
    audioWrap.className = "message-audio";

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = message.audioDataUrl;

    audioWrap.appendChild(audio);
    item.appendChild(audioWrap);
  }

  if (message.text && !message.imageDataUrl) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;
    item.appendChild(text);
  }

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const author = document.createElement("span");
  if (message.imageDataUrl && message.audioDataUrl) {
    author.textContent = "Anonymous media message";
  } else if (message.imageDataUrl) {
    author.textContent = "Anonymous photo message";
  } else if (message.audioDataUrl) {
    const effectLabel = getVoiceEffectLabel(message.audioEffect || "anonymous");
    const maskStrength = Number(message.audioMaskStrength) || DEFAULT_MASK_STRENGTH;
    author.textContent = `Anonymous voice note • ${effectLabel} • ${maskStrength}%`;
  } else {
    author.textContent = "Anonymous";
  }

  meta.append(author);
  item.append(meta);

  return item;
}

function renderMessages() {
  refs.messageCount.textContent = state.isLoadingMessages
    ? "Loading..."
    : `${state.messages.length} ${state.messages.length === 1 ? "message" : "messages"}`;

  refs.logoutButton.hidden = !state.adminUser;
  refs.adminLoading.hidden = !state.isLoadingMessages;
  refs.adminEmpty.hidden = state.isLoadingMessages || state.messages.length > 0;

  refs.messagesList.replaceChildren();

  if (!state.isLoadingMessages) {
    state.messages.forEach((message, index) => {
      refs.messagesList.appendChild(createMessageElement(message, index));
    });
  }
}

function renderView() {
  refs.publicView.hidden = state.isAdminMode;
  refs.adminSection.hidden = !state.isAdminMode;
  refs.successMessage.hidden = true;
  setFloatingWord(state.isAdminMode ? "ANONYMOUS 👻" : "cheteee🙌");

  if (state.isAdminMode || document.hidden) {
    stopFloatingWords();
  } else {
    startFloatingWords();
  }

  if (state.isAdminMode) {
    renderMessages();
  }
}

function stopMessageSubscription() {
  if (messagesUnsubscribe) {
    messagesUnsubscribe();
    messagesUnsubscribe = null;
  }
}

function stopAuthSubscription() {
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
}

function clearAdminHash() {
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState({}, "", url);
}

function goToPublicView() {
  clearAdminHash();
  stopMessageSubscription();
  stopAuthSubscription();
  state.isAdminMode = false;
  state.adminUser = null;
  state.messages = [];
  state.isLoadingMessages = false;
  renderView();
}

function subscribeToMessages() {
  stopMessageSubscription();
  state.isLoadingMessages = true;
  renderMessages();

  messagesUnsubscribe = db
    .collection("messages")
    .orderBy("timestamp", "desc")
    .onSnapshot(
      (snapshot) => {
        state.messages = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        state.isLoadingMessages = false;
        renderMessages();
      },
      (error) => {
        state.isLoadingMessages = false;
        renderMessages();
        alert("Cannot read messages: " + error.message);
      }
    );
}

function handleAdminAuth(user) {
  if (!state.isAdminMode) {
    return;
  }

  state.adminUser = user || null;
  refs.logoutButton.hidden = !state.adminUser;

  if (!user) {
    stopMessageSubscription();

    const email = window.prompt("Admin email:");
    const password = window.prompt("Admin password:");

    if (!email || !password) {
      alert("Login cancelled. Going back to form.");
      goToPublicView();
      return;
    }

    auth.signInWithEmailAndPassword(email, password).catch((err) => {
      alert("Login failed: " + err.message);
      goToPublicView();
    });

    return;
  }

  subscribeToMessages();
}

function startAdminMode() {
  stopAuthSubscription();
  state.isAdminMode = true;
  state.messages = [];
  state.isLoadingMessages = true;
  renderView();
  authUnsubscribe = auth.onAuthStateChanged(handleAdminAuth);
}

function handleRouteChange() {
  if (window.location.hash === "#admin") {
    startAdminMode();
    return;
  }

  goToPublicView();
}

async function handleSubmit(event) {
  event.preventDefault();

  const message = refs.messageInput.value.trim();
  const hasImage = Boolean(state.selectedImageDataUrl);
  const hasAudio = Boolean(state.recordedAudioDataUrl);
  if (!message && !hasImage && !hasAudio) {
    return;
  }

  try {
    setSubmitState(true);
    const imageDataUrl = hasImage ? await buildPhotoMessageDataUrl() : "";

    await db.collection("messages").add({
      text: message,
      imageDataUrl,
      audioDataUrl: state.recordedAudioDataUrl,
      audioDurationSeconds: state.recordedAudioDurationSeconds,
      audioEffect: state.recordedAudioEffect,
      audioMaskStrength: state.recordedAudioMaskStrength,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });

    resetComposer();
    showSuccessMessage();
  } catch (error) {
    alert("Failed to send: " + error.message);
  } finally {
    setSubmitState(false);
  }
}

async function handleAdminLogout() {
  try {
    stopMessageSubscription();
    stopAuthSubscription();
    await auth.signOut();
    goToPublicView();
  } catch (error) {
    alert("Logout error: " + error.message);
  }
}

async function applySelectedImageFile(file) {
  if (!file) {
    clearSelectedImage();
    return;
  }

  if (!file.type.startsWith("image/")) {
    clearSelectedImage();
    alert("Please choose a valid image file.");
    return;
  }

  if (state.recordedAudioDataUrl || state.isRecordingAudio || state.isPreparingAudio) {
    refs.imageInput.value = "";
    alert("Remove the voice note first. This version supports either one picture or one voice note per message.");
    return;
  }

  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    clearSelectedImage();
    alert("Please choose an image smaller than 25 MB.");
    return;
  }

  try {
    state.isPreparingImage = true;
    refs.imageStatus.textContent = `Loading ${file.name}...`;
    syncSubmitState();

    const previewUrl = await buildPreviewImageSource(file);
    revokeSelectedImageUrl();
    state.selectedImageDataUrl = previewUrl;
    state.selectedImageName = file.name;
  } catch (error) {
    clearSelectedImage();
    alert(getImageSelectionErrorMessage(file, error));
    return;
  } finally {
    state.isPreparingImage = false;
  }

  syncSubmitState();
  updatePreview();
}

function syncMessageDraftState() {
  updateCharCount();
  updatePreview();
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopFloatingWords();
    return;
  }

  startFloatingWords();
}

function handleImageSelection(event) {
  applySelectedImageFile(event.target.files?.[0] || null).catch(() => {});
}

function init() {
  refs.form.addEventListener("submit", handleSubmit);
  const handleMessageDraftChange = () => syncMessageDraftState();
  refs.messageInput.addEventListener("input", handleMessageDraftChange);
  refs.messageInput.addEventListener("change", handleMessageDraftChange);
  refs.imageInput.addEventListener("change", handleImageSelection);
  refs.clearImageButton.addEventListener("click", clearSelectedImage);
  refs.startRecordingButton.addEventListener("click", startVoiceRecording);
  refs.stopRecordingButton.addEventListener("click", stopVoiceRecording);
  refs.clearAudioButton.addEventListener("click", clearRecordedAudio);
  refs.voiceEffect.addEventListener("change", () => {
    syncSubmitState();
    updateVoiceRecorderUI();
  });
  refs.maskStrength.addEventListener("input", () => {
    syncSubmitState();
    updateVoiceRecorderUI();
  });
  refs.textPosition.addEventListener("change", updatePreview);
  refs.textSize.addEventListener("input", updatePreview);
  refs.logoutButton.addEventListener("click", handleAdminLogout);
  refs.backToFormLink.addEventListener("click", (event) => {
    event.preventDefault();
    goToPublicView();
  });
  window.addEventListener("hashchange", handleRouteChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  refs.previewImage.addEventListener("error", () => {
    if (!state.selectedImageDataUrl) {
      return;
    }

    clearSelectedImage();
    refs.previewPlaceholder.textContent = "This picture could not be previewed on this device. Try another image.";
    refs.imageStatus.textContent = "Preview failed for this image on this browser.";
  });

  updateCharCount();
  updatePreview();
  updateVoiceRecorderUI();
  handleRouteChange();
}

init();
