// ==================== GITHUB SYNC CONFIG ====================
const GITHUB_TOKEN = "ghp_YOUR_TOKEN_HERE"; // 🔴 ЗАМЕНИ НА СВОЙ TOKEN
const GITHUB_OWNER = "padobus";
const GITHUB_REPO = "turik";
const GITHUB_FILE_PATH = "players-data.json";
const SYNC_INTERVAL = 5000; // Синхронизация каждые 5 секунд

// ==================== DOM ELEMENTS ====================
const input = document.querySelector("#steamLink");
const button = document.querySelector("#registerButton");
const message = document.querySelector("#message");
const playersList = document.querySelector("#playersList");
const bracket = document.querySelector("#bracket");
const profileSelect = document.querySelector("#profileSelect");
const generateBracketButton = document.querySelector("#generateBracketButton");
const leaveTournamentButton = document.querySelector("#leaveTournamentButton");
const bracketMessage = document.querySelector("#bracketMessage");
const currentIpText = document.querySelector("#currentIpText");
const playersControlList = document.querySelector("#playersControlList");

// Начинаем с локального хранилища
let savedPlayers = JSON.parse(localStorage.getItem("players")) || [];
const adminSteamIds = new Set(["76561199205246483"]);

let currentIp = "";
let lastFileSha = null;

// ==================== GITHUB API FUNCTIONS ====================
async function loadPlayersFromGitHub() {
  if (!GITHUB_TOKEN || GITHUB_TOKEN === "ghp_YOUR_TOKEN_HERE") {
    console.warn("GitHub token не установлен. Используется локальное хранилище.");
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+raw",
        },
      }
    );

    if (!response.ok) {
      console.warn("Файл не найден на GitHub, используется локальное хранилище.");
      return;
    }

    const data = await response.json();
    
    if (data && data.content) {
      const decoded = atob(data.content);
      const players = JSON.parse(decoded);
      
      // Обновляем только если данные изменились
      if (JSON.stringify(players) !== JSON.stringify(savedPlayers)) {
        savedPlayers = players;
        localStorage.setItem("players", JSON.stringify(savedPlayers));
        renderRegistrationPlayersList();
        fillProfileSelect();
        updateProfileState();
      }
      
      lastFileSha = data.sha;
    }
  } catch (error) {
    console.error("Ошибка загрузки данных с GitHub:", error);
  }
}

async function savePlayersToGitHub() {
  if (!GITHUB_TOKEN || GITHUB_TOKEN === "ghp_YOUR_TOKEN_HERE") {
    console.warn("GitHub token не установлен. Данные сохраняются только локально.");
    return;
  }

  try {
    const content = btoa(JSON.stringify(savedPlayers, null, 2));

    // Сначала получаем текущий SHA файла
    const getResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
        },
      }
    );

    let sha = null;
    if (getResponse.ok) {
      const data = await getResponse.json();
      sha = data.sha;
    }

    // Теперь сохраняем файл
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `Update players data - ${new Date().toISOString()}`,
          content: content,
          sha: sha,
        }),
      }
    );

    if (!response.ok) {
      console.error("Ошибка сохранения на GitHub:", response.statusText);
    }
  } catch (error) {
    console.error("Ошибка при синхронизации с GitHub:", error);
  }
}

// ==================== INITIALIZATION ====================
initRegistrationPage();
initBracketPage();

// Загружаем данные с GitHub при старте
loadPlayersFromGitHub();

// Периодическая синхронизация
setInterval(loadPlayersFromGitHub, SYNC_INTERVAL);

async function initRegistrationPage() {
  if (!button || !input || !message || !playersList) {
    return;
  }

  const registeredPlayers = new Set(savedPlayers.map((player) => player.id));

  applyAdminRights();
  currentIp = await getCurrentIp();
  renderRegistrationPlayersList();

  if (!currentIp) {
    showMessage("IP не удалось определить. Проверьте интернет и попробуйте снова.", true);
  }

  button.addEventListener("click", async () => {
    const steamLink = input.value.trim();

    if (steamLink === "") {
      showMessage("Вставьте ссылку на Steam профиль", true);
      return;
    }

    const profileUrl = getSteamProfileUrl(steamLink);

    if (!profileUrl) {
      showMessage("Это не похоже на ссылку Steam. Пример: https://steamcommunity.com/id/name", true);
      return;
    }

    if (!currentIp) {
      currentIp = await getCurrentIp();
    }

    if (!currentIp) {
      showMessage("Не могу привязать профиль: IP не определен.", true);
      return;
    }

    const playerWithSameIp = savedPlayers.find((player) => player.ip === currentIp);

    if (playerWithSameIp) {
      showMessage(`Этот IP уже привязан к Steam аккаунту: ${playerWithSameIp.name}`, true);
      return;
    }

    button.disabled = true;
    button.textContent = "Загрузка...";
    showMessage("Пробую загрузить профиль Steam...");

    try {
      const player = await createPlayerFromSteamLink(profileUrl);

      if (registeredPlayers.has(player.id)) {
        showMessage("Этот игрок уже зарегистрирован", true);
        return;
      }

      player.canGenerate = isAdminPlayer(player);
      player.canManage = isAdminPlayer(player);
      player.ip = currentIp;
      player.registeredAt = new Date().toISOString();

      registeredPlayers.add(player.id);
      savedPlayers.push(player);
      savePlayers();

      renderRegistrationPlayersList();
      input.value = "";

      showMessage(
        player.loadedFromSteam
          ? `Игрок зарегистрирован и привязан к IP ${currentIp}`
          : `Игрок зарегистрирован по ссылке и привязан к IP ${currentIp}. Steam не отдал имя и аватар автоматически.`
      );
    } catch (error) {
      showMessage("Не удалось зарегистрировать профиль. Проверьте ссылку.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Зарегистрироваться";
    }
  });
}

async function initBracketPage() {
  if (!generateBracketButton || !bracketMessage || !bracket) {
    return;
  }

  bracket.textContent = "";
  applyAdminRights();
  currentIp = await getCurrentIp();

  if (currentIpText) {
    currentIpText.textContent = currentIp ? `Ваш IP: ${currentIp}` : "Ваш IP не удалось определить";
  }

  if (profileSelect) {
    profileSelect.hidden = true;
  }

  fillProfileSelect();
  updateProfileState();

  generateBracketButton.addEventListener("click", () => {
    const selectedPlayer = getCurrentPlayerByIp();

    if (!canGenerateBracket(selectedPlayer)) {
      bracket.textContent = "";
      bracketMessage.textContent = getSelectedProfileStatus(selectedPlayer);
      return;
    }

    renderBracket();
    bracketMessage.textContent = `Сетка сгенерирована профилем: ${selectedPlayer.name}`;
  });

  if (leaveTournamentButton) {
    leaveTournamentButton.addEventListener("click", leaveTournament);
  }
}

function fillProfileSelect() {
  if (!profileSelect) {
    return;
  }

  profileSelect.textContent = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Выберите Steam профиль";
  profileSelect.append(placeholder);

  savedPlayers.forEach((player) => {
    const option = document.createElement("option");
    const accessText = player.canGenerate ? "доступ есть" : "нет доступа";
    const manageText = player.canManage ? "управление есть" : "без управления";
    const ipText = player.ip ? `IP ${player.ip}` : "IP не привязан";

    option.value = player.id;
    option.textContent = `${player.name} - ${accessText}, ${manageText}, ${ipText}`;
    profileSelect.append(option);
  });
}

function applyAdminRights() {
  let hasChanges = false;

  savedPlayers.forEach((player) => {
    if (!isAdminPlayer(player)) {
      return;
    }

    if (!player.canGenerate || !player.canManage) {
      player.canGenerate = true;
      player.canManage = true;
      hasChanges = true;
    }
  });

  if (hasChanges) {
    savePlayers();
  }
}

function isAdminPlayer(player) {
  return adminSteamIds.has(getPlayerSteamId(player));
}

function getPlayerSteamId(player) {
  if (!player) {
    return "";
  }

  const id = String(player.id || "");
  const url = String(player.url || "");
  const profileIdFromUrl = url.match(/steamcommunity\.com\/profiles\/(\d+)/i)?.[1] || "";

  return adminSteamIds.has(id) ? id : profileIdFromUrl;
}

function canGrantRights(player) {
  return Boolean(isAdminPlayer(player) && isSameIp(player));
}

function updateProfileState() {
  const selectedPlayer = getCurrentPlayerByIp();
  const canGenerate = canGenerateBracket(selectedPlayer);

  generateBracketButton.disabled = !canGenerate;
  generateBracketButton.hidden = !canGenerate;
  if (leaveTournamentButton) {
    leaveTournamentButton.disabled = !selectedPlayer;
    leaveTournamentButton.hidden = !selectedPlayer;
  }
  bracketMessage.textContent = getSelectedProfileStatus(selectedPlayer);
  renderPlayersControlList(selectedPlayer);
}

function getSelectedProfileStatus(player) {
  if (!currentIp) {
    return "Не удалось определить ваш IP. Проверьте интернет и обновите страницу.";
  }

  if (!player) {
    return `Для IP ${currentIp} не найден привязанный Steam аккаунт. Зарегистрируйтесь с этого устройства.`;
  }
  if (!player) {
    return "Выберите профиль, которому выдали доступ.";
  }

  if (!isSameIp(player)) {
    return "Текущий IP не совпадает с IP выбранного Steam профиля.";
  }

  if (!player.canGenerate && !player.canManage) {
    return "Профиль найден, но ему еще не выдали права.";
  }

  if (player.canGenerate && player.canManage) {
    return "Доступ к сетке и управление игроками подтверждены.";
  }

  if (player.canGenerate) {
    return "Доступ к сетке подтвержден.";
  }

  return "Управление игроками подтверждено.";
}

function canGenerateBracket(player) {
  return Boolean(player?.canGenerate && isSameIp(player));
}

function canManagePlayers(player) {
  return Boolean(player?.canManage && isSameIp(player));
}

function canLeaveTournament(player) {
  return Boolean(player && isSameIp(player));
}

function renderPlayersControlList(manager) {
  if (!playersControlList) {
    return;
  }

  playersControlList.textContent = "";

  const canManage = canManagePlayers(manager);

  savedPlayers.forEach((player) => {
    const listItem = document.createElement("li");
    const avatar = document.createElement("img");
    const playerInfo = document.createElement("div");
    const playerName = document.createElement("strong");
    const profileLink = document.createElement("a");
    const meta = document.createElement("small");
    const kickButton = document.createElement("button");

    listItem.className = "player";
    playerInfo.className = "player-info";
    avatar.src = player.avatar || getDefaultAvatar();
    avatar.alt = "";
    playerName.textContent = player.name;
    profileLink.href = player.url;
    profileLink.target = "_blank";
    profileLink.rel = "noreferrer";
    profileLink.textContent = "Steam профиль";
    meta.textContent = getPlayerMeta(player);
    kickButton.className = "kick-button";
    kickButton.type = "button";
    kickButton.textContent = "Кикнуть";
    kickButton.disabled = !canManage || player.id === manager?.id;

    kickButton.addEventListener("click", () => {
      if (!canManagePlayers(getCurrentPlayerByIp())) {
        updateProfileState();
        return;
      }

      kickPlayer(player.id);
    });

    playerInfo.append(playerName, document.createElement("br"), profileLink, document.createElement("br"), meta);
    listItem.append(avatar, playerInfo, kickButton);
    playersControlList.append(listItem);
  });
}

function kickPlayer(playerId) {
  const playerIndex = savedPlayers.findIndex((player) => player.id === playerId);

  if (playerIndex === -1) {
    return;
  }

  const kickedPlayer = savedPlayers[playerIndex];
  savedPlayers.splice(playerIndex, 1);
  savePlayers();
  fillProfileSelect();
  updateProfileState();
  bracket.textContent = "";
  bracketMessage.textContent = `${kickedPlayer.name} кикнут из турнира.`;
}

function leaveTournament() {
  const selectedPlayer = getCurrentPlayerByIp();

  if (!selectedPlayer) {
    bracketMessage.textContent = "Сначала выберите свой Steam профиль.";
    return;
  }

  if (!canLeaveTournament(selectedPlayer)) {
    bracketMessage.textContent = "Нельзя выйти: текущий IP не совпадает с IP выбранного Steam профиля.";
    return;
  }

  removePlayer(selectedPlayer.id, `${selectedPlayer.name} вышел из турнира.`);
}

function removePlayer(playerId, successMessage) {
  const playerIndex = savedPlayers.findIndex((player) => player.id === playerId);

  if (playerIndex === -1) {
    return;
  }

  savedPlayers.splice(playerIndex, 1);
  savePlayers();
  fillProfileSelect();
  updateProfileState();
  bracket.textContent = "";
  bracketMessage.textContent = successMessage;
}

function getSelectedPlayer() {
  return getCurrentPlayerByIp();
}

function getCurrentPlayerByIp() {
  return savedPlayers.find((player) => isSameIp(player));
}

function isSameIp(player) {
  return Boolean(player.ip && currentIp && player.ip === currentIp);
}

async function getCurrentIp() {
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
    });

    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    return typeof data.ip === "string" ? data.ip : "";
  } catch (error) {
    return "";
  }
}

function renderBracket() {
  bracket.textContent = "";

  if (savedPlayers.length < 2) {
    bracketMessage.textContent = "Для генерации сетки нужно минимум 2 участника.";
    return;
  }

  const bracketSize = getBracketSize(savedPlayers.length);
  const players = getBracketPlayers(bracketSize);
  const firstRoundMatches = bracketSize / 2;
  const rounds = getRounds(bracketSize);

  bracket.style.setProperty("--round-count", rounds.length);
  bracket.style.setProperty("--slot-count", firstRoundMatches);

  rounds.forEach((round, roundIndex) => {
    const roundElement = document.createElement("div");
    const title = document.createElement("h2");
    const span = firstRoundMatches / round.matches;

    roundElement.className = "round";
    title.textContent = round.title;
    roundElement.append(title);

    for (let matchIndex = 0; matchIndex < round.matches; matchIndex += 1) {
      const match = document.createElement("div");
      const firstSlot = document.createElement("span");
      const secondSlot = document.createElement("span");

      match.className = "match";
      match.style.gridRow = `${2 + matchIndex * span} / span ${span}`;

      if (roundIndex === 0) {
        firstSlot.textContent = players[matchIndex * 2];
        secondSlot.textContent = players[matchIndex * 2 + 1];
      } else if (round.matches === 1) {
        firstSlot.textContent = "Финалист 1";
        secondSlot.textContent = "Финалист 2";
      } else {
        const startWinner = matchIndex * 2 + 1;
        firstSlot.textContent = `Победитель ${startWinner}`;
        secondSlot.textContent = `Победитель ${startWinner + 1}`;
      }

      match.append(firstSlot, secondSlot);
      roundElement.append(match);
    }

    if (round.matches === 1) {
      const winner = document.createElement("div");

      winner.className = "winner";
      winner.textContent = "Победитель";
      winner.style.gridRow = `${firstRoundMatches + 1}`;
      roundElement.append(winner);
    }

    bracket.append(roundElement);
  });
}

function getBracketSize(playersCount) {
  let size = 2;

  while (size < playersCount) {
    size *= 2;
  }

  return size;
}

function getBracketPlayers(bracketSize) {
  const names = savedPlayers.map((player) => player.name);

  return Array.from({ length: bracketSize }, (_, index) => {
    return names[index] || "BYE";
  });
}

function getRounds(bracketSize) {
  const titles = {
    16: "1/8 финала",
    8: "1/4 финала",
    4: "Полуфинал",
    2: "Финал",
  };
  const rounds = [];

  for (let playersInRound = bracketSize; playersInRound >= 2; playersInRound /= 2) {
    rounds.push({
      title: titles[playersInRound] || `Раунд ${rounds.length + 1}`,
      matches: playersInRound / 2,
    });
  }

  return rounds;
}

function getSteamProfileUrl(link) {
  try {
    const preparedLink = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    const url = new URL(preparedLink);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host !== "steamcommunity.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);

    if ((parts[0] !== "id" && parts[0] !== "profiles") || !parts[1]) {
      return null;
    }

    return `https://steamcommunity.com/${parts[0]}/${parts[1]}`;
  } catch (error) {
    return null;
  }
}

async function createPlayerFromSteamLink(profileUrl) {
  try {
    const profile = await loadSteamProfile(profileUrl);
    return {
      ...profile,
      loadedFromSteam: true,
    };
  } catch (error) {
    return createFallbackPlayer(profileUrl);
  }
}

async function loadSteamProfile(profileUrl) {
  const xmlUrl = `${profileUrl}?xml=1`;
  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(xmlUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(xmlUrl)}`,
  ];

  for (const proxyUrl of proxyUrls) {
    try {
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        continue;
      }

      const xmlText = await response.text();
      const xml = new DOMParser().parseFromString(xmlText, "text/xml");
      const steamId = getXmlText(xml, "steamID64") || profileUrl;
      const name = getXmlText(xml, "steamID");
      const avatar = getXmlText(xml, "avatarFull") || getXmlText(xml, "avatarMedium");

      if (name && avatar) {
        return {
          id: steamId,
          name,
          avatar,
          url: profileUrl,
          canGenerate: false,
          canManage: false,
        };
      }
    } catch (error) {
      // Try the next proxy, then fall back to the link itself.
    }
  }

  throw new Error("Profile data not found");
}

function createFallbackPlayer(profileUrl) {
  const url = new URL(profileUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const profileName = decodeURIComponent(parts[1] || "Steam игрок");

  return {
    id: profileUrl,
    name: parts[0] === "profiles" ? `Steam ${profileName}` : profileName,
    avatar: getDefaultAvatar(),
    url: profileUrl,
    canGenerate: false,
    canManage: false,
    loadedFromSteam: false,
  };
}

function getDefaultAvatar() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect width="128" height="128" fill="#00d18f"/>
      <circle cx="64" cy="46" r="24" fill="#111"/>
      <path d="M24 116c6-25 22-38 40-38s34 13 40 38" fill="#111"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getXmlText(xml, tagName) {
  return xml.querySelector(tagName)?.textContent.trim();
}

function addPlayer(player) {
  const listItem = document.createElement("li");
  const avatar = document.createElement("img");
  const playerInfo = document.createElement("div");
  const playerName = document.createElement("strong");
  const profileLink = document.createElement("a");
  const meta = document.createElement("small");
  const actions = document.createElement("div");
  const accessButton = document.createElement("button");
  const manageButton = document.createElement("button");

  listItem.className = "player";
  playerInfo.className = "player-info";
  actions.className = "player-actions";
  avatar.src = player.avatar || getDefaultAvatar();
  avatar.alt = "";
  playerName.textContent = player.name;
  profileLink.href = player.url;
  profileLink.target = "_blank";
  profileLink.rel = "noreferrer";
  profileLink.textContent = "Steam профиль";
  meta.textContent = getPlayerMeta(player);
  accessButton.className = "access-button";
  accessButton.type = "button";
  manageButton.className = "access-button";
  manageButton.type = "button";
  updateAccessButton(accessButton, player);
  updateManageButton(manageButton, player);

  const canGrant = canGrantRights(getCurrentPlayerByIp());
  actions.hidden = !canGrant;

  accessButton.addEventListener("click", () => {
    if (!canGrantRights(getCurrentPlayerByIp())) {
      renderRegistrationPlayersList();
      return;
    }

    player.canGenerate = !player.canGenerate;
    if (isAdminPlayer(player)) {
      player.canGenerate = true;
    }
    savePlayers();
    updateAccessButton(accessButton, player);
    meta.textContent = getPlayerMeta(player);
  });

  manageButton.addEventListener("click", () => {
    if (!canGrantRights(getCurrentPlayerByIp())) {
      renderRegistrationPlayersList();
      return;
    }

    player.canManage = !player.canManage;
    if (isAdminPlayer(player)) {
      player.canManage = true;
    }
    savePlayers();
    updateManageButton(manageButton, player);
    meta.textContent = getPlayerMeta(player);
  });

  playerInfo.append(playerName, document.createElement("br"), profileLink, document.createElement("br"), meta);
  actions.append(accessButton, manageButton);
  listItem.append(avatar, playerInfo, actions);

  playersList.append(listItem);
}

function renderRegistrationPlayersList() {
  if (!playersList) {
    return;
  }

  applyAdminRights();
  playersList.textContent = "";
  savedPlayers.forEach(addPlayer);
}

function getPlayerMeta(player) {
  const ipText = player.ip || "не привязан";
  const accessText = player.canGenerate ? "сетка: да" : "сетка: нет";
  const manageText = player.canManage ? "кик: да" : "кик: нет";

  return `IP: ${ipText} | ${accessText} | ${manageText}`;
}

function updateAccessButton(accessButton, player) {
  accessButton.textContent = player.canGenerate ? "Убрать доступ" : "Дать доступ";
  accessButton.classList.toggle("access-button-active", Boolean(player.canGenerate));
}

function updateManageButton(manageButton, player) {
  manageButton.textContent = player.canManage ? "Убрать управление" : "Дать управление";
  manageButton.classList.toggle("access-button-active", Boolean(player.canManage));
}

function savePlayers() {
  // Сохраняем локально
  localStorage.setItem("players", JSON.stringify(savedPlayers));
  
  // И в GitHub
  savePlayersToGitHub();
}

function showMessage(text, isError = false) {
  if (!message) return;
  message.textContent = text;
  message.style.color = isError ? "#ff5c5c" : "#00d18f";
}
