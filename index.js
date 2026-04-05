const firebaseConfig = window.__ENV__?.FIREBASE_CONFIG;

if (!firebaseConfig) {
  throw new Error("Missing Firebase config. Start the app through the local server so env vars can be loaded.");
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
  adminUser: null,
  messages: [],
  floatingWord: "cheteee🙌",
};

let authUnsubscribe = null;
let messagesUnsubscribe = null;
let floatingInterval = null;
let successTimeout = null;

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

function setSubmitState(isSending) {
  state.isSending = isSending;
  refs.submitButton.disabled = isSending || refs.messageInput.value.trim().length === 0;
  refs.submitButton.classList.toggle("loading", isSending);
  refs.submitLabel.textContent = isSending ? "Sending..." : "Send Message";
}

function updateCharCount() {
  refs.charCount.textContent = `${refs.messageInput.value.length} / 500`;
  if (!state.isSending) {
    refs.submitButton.disabled = refs.messageInput.value.trim().length === 0;
  }
}

function showSuccessMessage() {
  refs.successMessage.hidden = false;
  window.clearTimeout(successTimeout);
  successTimeout = window.setTimeout(() => {
    refs.successMessage.hidden = true;
  }, 3000);
}

function createMessageElement(message, index) {
  const item = document.createElement("div");
  item.className = "message-item";
  item.style.animationDelay = `${index * 0.1}s`;

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = message.text || "";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.style.display = "flex";
  meta.style.justifyContent = "space-between";
  meta.style.gap = "10px";

  const author = document.createElement("span");
  author.textContent = "Anonymous";

  meta.append(author);
  item.append(text, meta);

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
  if (!message) {
    return;
  }

  try {
    setSubmitState(true);

    await db.collection("messages").add({
      text: message,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });

    refs.messageInput.value = "";
    updateCharCount();
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

function init() {
  refs.form.addEventListener("submit", handleSubmit);
  refs.messageInput.addEventListener("input", updateCharCount);
  refs.logoutButton.addEventListener("click", handleAdminLogout);
  refs.backToFormLink.addEventListener("click", (event) => {
    event.preventDefault();
    goToPublicView();
  });
  window.addEventListener("hashchange", handleRouteChange);

  updateCharCount();
  renderView();
  startFloatingWords();
  handleRouteChange();
}

init();
