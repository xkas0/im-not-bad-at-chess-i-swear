// I Swear I'm Good at Chess
// puzzles come from positions.json (made by magic_generator.py), every move already has a stockfish score

const PIECE_ICONS = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
const FILES = "abcdefgh";
const HOW_MANY_ROUNDS = 8;
const SECONDS_NORMAL = 30;
const SECONDS_FAST = 5;
const MAX_SCORE = HOW_MANY_ROUNDS * 100;
const MIN_SCORE = -MAX_SCORE;
const MAX_FRUIT_SLICES = 24;  // 3 yuzu x 8 slices

// moves ranked above this cost you points (0 = worst move, 1 = best)
const GOOD_MOVE_CUTOFF = 0.75;
// was 50, now 100 so -800 is actually possible
const BEST_MOVE_PENALTY = 100;

const TIER_NAMES = ["Peak blunder", "Disaster", "Ugly", "Meh", "Suspiciously sensible", "Too slow"];
const SHAKE_POWER = [16, 11, 8, 5, 3, 0];
const DEBRIS_COUNT = [22, 16, 12, 8, 5];

// game state
let puzzles = [];
let roundNo = 0;
let pickedSquare = null;  // the square you clicked first, like "e2"
let frozen = false;  // true once you moved or ran out of time
let started = false;  // false until you press play
let scoreboard = [];
let boardAfterMove = null;
let landingSquare = null;
let landingEl = null;
let glow = {};
let clockTimer = null;
let moveStartedAt = 0;
let queenLost = false;

let fastMode = false;
try { fastMode = localStorage.getItem("fastMode") === "1"; } catch (e) {}
let secondsPerMove = fastMode ? SECONDS_FAST : SECONDS_NORMAL;

// saving stuff

// the dev panel turns this off for its fake games
let savingScores = true;

function bestKey() {
  return fastMode ? "bestScoreFast" : "bestScore";
}

function readBest() {
  try {
    const saved = localStorage.getItem(bestKey());
    return saved === null ? null : Number(saved);
  } catch (e) {
    return null;
  }
}

function saveBest(score) {
  try { localStorage.setItem(bestKey(), String(score)); } catch (e) {}
}

function showBest() {
  const best = readBest();
  document.getElementById("best").textContent = best === null ? "" : (fastMode ? "😰 Best " : "Best ") + best;
}

function readStats() {
  try {
    return JSON.parse(localStorage.getItem("capyStats")) || {};
  } catch (e) {
    return {};
  }
}

function writeStats(stats) {
  try { localStorage.setItem("capyStats", JSON.stringify(stats)); } catch (e) {}
}

function dayString(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// chess helpers

function readFen(fen) {
  const [placement, turn] = fen.split(" ");
  const grid = placement.split("/").map(function (rankText) {
    const cells = [];
    for (const ch of rankText) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else {
        cells.push(ch);
      }
    }
    return cells;
  });
  return { grid, turn };
}

function squareName(row, col) {
  return FILES[col] + (8 - row);
}

function whoIsOn(grid, name) {
  return grid[8 - name[1]][FILES.indexOf(name[0])];
}

// forced mates are around +-10000, that wrecks everything so squish them
function squish(v) {
  return Math.max(-1000, Math.min(1000, v));
}

// q: 0 = worst move, 1 = best move
function judgeMove(move, scores) {
  const sorted = Object.values(scores).sort((a, b) => a - b);
  const n = sorted.length;
  // ties count as the extreme
  let q;
  if (n < 2 || scores[move] === sorted[0]) q = 0;
  else if (scores[move] === sorted[n - 1]) q = 1;
  else q = sorted.indexOf(scores[move]) / (n - 1);

  let tier;
  if (scores[move] === sorted[0]) tier = 0;
  else if (q < 0.12) tier = 1;
  else if (q < 0.35) tier = 2;
  else if (q < GOOD_MOVE_CUTOFF) tier = 3;
  else tier = 4;

  let points;
  if (q < GOOD_MOVE_CUTOFF) {
    points = Math.round(100 * Math.pow(1 - q / GOOD_MOVE_CUTOFF, 2.2));
  } else {
    points = -Math.round((q - GOOD_MOVE_CUTOFF) / (1 - GOOD_MOVE_CUTOFF) * BEST_MOVE_PENALTY);
  }
  return { t: tier, ratio: 1 - q, points: points };
}

function prettyMove(fen, uci) {
  if (!uci) return "Time's up";
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const piece = whoIsOn(readFen(fen).grid, from);
  const icon = piece ? PIECE_ICONS[piece.toLowerCase()] + "︎ " : "";
  const promo = uci[4] ? "=" + uci[4].toUpperCase() : "";
  return icon + from + "→" + to + promo;
}

// moves a piece on the grid, returns whatever it captured
function movePiece(grid, uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const piece = whoIsOn(grid, from);
  if (!piece) return null;

  const fromRow = 8 - from[1];
  const fromCol = FILES.indexOf(from[0]);
  const toRow = 8 - to[1];
  const toCol = FILES.indexOf(to[0]);
  let captured = grid[toRow][toCol];

  let landed = piece;
  if (uci[4]) landed = piece === piece.toUpperCase() ? uci[4].toUpperCase() : uci[4];

  // en passant
  if (piece.toLowerCase() === "p" && fromCol !== toCol && !captured) {
    captured = grid[fromRow][toCol];
    grid[fromRow][toCol] = null;
  }
  // castling
  if (piece.toLowerCase() === "k" && Math.abs(toCol - fromCol) === 2) {
    const rookFrom = toCol > fromCol ? 7 : 0;
    const rookTo = toCol > fromCol ? toCol - 1 : toCol + 1;
    grid[fromRow][rookTo] = grid[fromRow][rookFrom];
    grid[fromRow][rookFrom] = null;
  }

  grid[toRow][toCol] = landed;
  grid[fromRow][fromCol] = null;
  return captured;
}

function totalPoints() {
  return scoreboard.reduce((sum, r) => sum + r.points, 0);
}

// +1 white to move, -1 black (scores are from the mover's side)
function sideSign(fen) {
  return readFen(fen).turn === "w" ? 1 : -1;
}

// eval after the best move, from white's side
function evalBeforeMove() {
  const p = puzzles[roundNo];
  return Math.max(...Object.values(p.scores).map(squish)) * sideSign(p.fen);
}

// drawing

function drawRoundDots() {
  let html = "";
  for (let i = 0; i < HOW_MANY_ROUNDS; i++) {
    const r = scoreboard[i];
    if (r) {
      html += `<i class="t${r.t}" style="background:var(--tc)"></i>`;
    } else if (i === roundNo) {
      html += `<i class="on"></i>`;
    } else {
      html += `<i></i>`;
    }
  }
  document.getElementById("dots").innerHTML = html;
}

function drawBoard() {
  const puzzle = puzzles[roundNo];
  const { grid: startGrid, turn } = readFen(puzzle.fen);
  const grid = boardAfterMove || startGrid;
  const board = document.getElementById("board");
  board.innerHTML = "";
  landingEl = null;

  const flip = turn === "b";
  document.querySelector(".evalbar").classList.toggle("flipped", flip);

  let targets = new Set();
  if (pickedSquare && !frozen) {
    const moves = Object.keys(puzzle.scores).filter(m => m.startsWith(pickedSquare));
    targets = new Set(moves.map(m => m.slice(2, 4)));
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const row = flip ? 7 - r : r;
      const col = flip ? 7 - c : c;
      const name = squareName(row, col);
      const piece = grid[row][col];

      const sq = document.createElement("div");
      sq.className = "sq " + ((row + col) % 2 === 0 ? "l" : "d");
      sq.dataset.sq = name;

      if (piece) {
        const icon = document.createElement("span");
        const isWhite = piece === piece.toUpperCase();
        icon.className = "pc " + (isWhite ? "w" : "b") + (name === landingSquare ? " stomp" : "");
        icon.textContent = PIECE_ICONS[piece.toLowerCase()] + "︎";
        sq.append(icon);
      }

      if (name === pickedSquare) sq.classList.add("sel");
      if (glow[name] !== undefined) sq.classList.add("mv", "t" + glow[name]);
      if (targets.has(name)) sq.classList.add(piece ? "cap" : "dot");
      if (name === landingSquare) landingEl = sq;

      sq.onclick = () => onSquareClick(name);
      board.append(sq);
    }
  }

  const who = turn === "w" ? "White" : "Black";
  document.getElementById("status").textContent = frozen ? "" : who + " to move. Click a piece, then its destination.";
  drawRoundDots();
  drawModeButtons();
}

// ring + flying bits when your piece slams down
function kaboom(tier, spot = landingEl, extraBits = 0) {
  const fx = document.getElementById("fx");
  if (!spot || !SHAKE_POWER[tier]) return;

  const x = spot.offsetLeft + spot.offsetWidth / 2;
  const y = spot.offsetTop + spot.offsetHeight / 2;

  const ring = document.createElement("div");
  ring.className = "ring t" + tier;
  ring.style.cssText = `--x:${x}px;--y:${y}px`;
  fx.append(ring);

  const colours = ["#ffc83d", "#ff8a3d", "#ff4d6d", "#f2efff"];
  for (let i = 0; i < DEBRIS_COUNT[tier] + extraBits; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 80;
    const bit = document.createElement("div");
    bit.className = "deb";
    bit.style.cssText =
      `--x:${x}px;--y:${y}px;` +
      `--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 20}px;` +
      `--r:${Math.random() * 360}deg;--s:${6 + Math.random() * 14}px;` +
      `--b:${i % 3 ? 0 : 4}px;--c:${colours[i % 4]}`;
    fx.append(bit);
  }
}

function showClockFull() {
  document.getElementById("clockfill").style.width = "100%";
  document.getElementById("clockfill").classList.remove("low");
  document.getElementById("clocktext").textContent = secondsPerMove + "s";
}

function startGame() {
  started = true;
  document.getElementById("boardwrap").classList.remove("waiting");
  document.getElementById("gate").hidden = true;
  drawModeButtons();
  startClock();
}

function startClock() {
  clearInterval(clockTimer);
  const startedAt = Date.now();
  moveStartedAt = startedAt;
  const fill = document.getElementById("clockfill");
  const text = document.getElementById("clocktext");
  let lastTickSecond = -1;

  clockTimer = setInterval(() => {
    const left = secondsPerMove - (Date.now() - startedAt) / 1000;
    fill.style.width = Math.max(0, left / secondsPerMove * 100) + "%";
    fill.classList.toggle("low", left < (fastMode ? 2 : 8));
    text.textContent = Math.max(0, Math.ceil(left)) + "s";
    const wholeSeconds = Math.ceil(left);
    if (left > 0 && wholeSeconds <= (fastMode ? 3 : 5) && wholeSeconds !== lastTickSecond) {
      lastTickSecond = wholeSeconds;
      sfx.play("clock", wholeSeconds);
    }
    if (left <= 0) outOfTime();
  }, 200);
}

function outOfTime() {
  clearInterval(clockTimer);
  frozen = true;
  pickedSquare = null;
  const puzzle = puzzles[roundNo];
  scoreboard.push({ fen: puzzle.fen, scores: puzzle.scores, move: null, t: 5, ratio: 0, points: 0 });
  drawBoard();
  showVerdict();
}

function onSquareClick(name) {
  if (frozen || !started) return;

  const { grid, turn } = readFen(puzzles[roundNo].fen);
  const piece = whoIsOn(grid, name);
  const isMine = piece && (piece === piece.toUpperCase()) === (turn === "w");

  if (pickedSquare === null) {
    if (isMine) {
      pickedSquare = name;
      sfx.play("select");
      drawBoard();
    }
    return;
  }
  if (name === pickedSquare) {
    pickedSquare = null;
    drawBoard();
    return;
  }
  if (isMine) {
    pickedSquare = name;
    sfx.play("select");
    drawBoard();
    return;
  }
  playMove(pickedSquare + name);
}

function playMove(uci) {
  const puzzle = puzzles[roundNo];
  const scores = puzzle.scores;

  // TODO: promotion is always a queen for now
  let move = uci;
  if (!(move in scores)) move = uci + "q";

  if (!(move in scores)) {
    pickedSquare = null;
    drawBoard();
    document.getElementById("status").textContent = "Not a legal move. Try another.";
    return;
  }

  clearInterval(clockTimer);
  const verdict = judgeMove(move, scores);
  scoreboard.push({ fen: puzzle.fen, scores: scores, move: move, secs: (Date.now() - moveStartedAt) / 1000, limit: secondsPerMove, ...verdict });
  frozen = true;
  pickedSquare = null;

  const { grid } = readFen(puzzle.fen);
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  boardAfterMove = grid.map(rank => rank.slice());
  movePiece(boardAfterMove, move);

  landingSquare = to;
  glow = { [from]: verdict.t, [to]: verdict.t };
  drawBoard();
  kaboom(verdict.t);
  shakeTheBoard(verdict.t);
  setTimeout(() => sfx.play("stomp", verdict.t), 220);

  setTimeout(() => punishTheMove(move, showVerdict), 800);
}

function shakeTheBoard(tier, power) {
  const board = document.getElementById("board");
  board.style.setProperty("--a", (power === undefined ? SHAKE_POWER[tier] : power) + "px");
  board.classList.remove("shake");
  void board.offsetWidth;  // don't ask. restarts the css animation
  board.classList.add("shake");
}

// punishment

const CAPTURE_SHOUTS = {
  p: ["NOM", "SNACK TIME", "PAWN DOWN"],
  n: ["CLONK", "HORSEY DOWN", "NEIGH-O"],
  b: ["SLICE", "HOLY MOLY", "BISHOP DOWN"],
  r: ["KABOOM", "TOWER DOWN", "RUUUIN"],
  q: ["ROYAL DISASTER", "YOUR MAJESTY!!", "NOT THE QUEEN"]
};
const QUIET_SHOUTS = ["Quietly crushing.", "Calm. Menacing.", "No capture needed.", "Tsk."];

// [boom size, extra debris, shake, sound level] per captured piece
const CAPTURE_POWER = { p: [3, 0, 8, 0], n: [2, 6, 12, 1], b: [2, 6, 12, 1], r: [1, 14, 17, 2], q: [0, 34, 26, 3] };

function squareEl(name) {
  return document.querySelector(`#board [data-sq="${name}"]`);
}

function flashBoard() {
  const flash = document.createElement("div");
  flash.className = "boardflash";
  document.getElementById("fx").append(flash);
  flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 450, easing: "ease-out" }).onfinish = () => flash.remove();
}

function shout(text, big) {
  const el = document.createElement("div");
  el.className = "shout" + (big ? " big" : "");
  el.textContent = text;
  document.getElementById("fx").append(el);
  el.animate([
    { transform: "translate(-50%,-50%) scale(.3) rotate(-8deg)", opacity: 0 },
    { transform: "translate(-50%,-50%) scale(1.25) rotate(-4deg)", opacity: 1, offset: 0.3 },
    { transform: "translate(-50%,-58%) scale(1) rotate(-4deg)", opacity: 1, offset: 0.75 },
    { transform: "translate(-50%,-90%) scale(1) rotate(-4deg)", opacity: 0 }
  ], { duration: big ? 1300 : 900, easing: "ease-out" }).onfinish = () => el.remove();
}

function flyAway(pieceEl) {
  pieceEl.style.zIndex = 15;
  pieceEl.animate([
    { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
    { transform: `translate(${rand(-70, 70)}px, -150px) rotate(${rand(-720, 720)}deg) scale(2.4)`, opacity: 0 }
  ], { duration: 750, easing: "ease-out", fill: "forwards" });
}

function punishTheMove(move, whenDone) {
  const reply = puzzles[roundNo].replies && puzzles[roundNo].replies[move];
  const mover = reply ? squareEl(reply.slice(0, 2)) : null;
  const target = reply ? squareEl(reply.slice(2, 4)) : null;
  const pieceEl = mover && mover.querySelector(".pc");
  if (!pieceEl || !target || reducedMotion) {
    whenDone();
    return;
  }

  const afterReply = boardAfterMove.map(rank => rank.slice());
  const captured = movePiece(afterReply, reply);
  const victim = captured ? captured.toLowerCase() : null;
  if (victim === "q") queenLost = true;

  const power = victim ? CAPTURE_POWER[victim] : [4, 0, 4, 0];
  const dx = target.offsetLeft - mover.offsetLeft;
  const dy = target.offsetTop - mover.offsetTop;
  const slideMs = 320;

  sfx.play("whoosh");
  pieceEl.style.zIndex = 20;
  const slide = pieceEl.animate([
    { transform: "translate(0,0) scale(1)" },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 18}px) scale(1.5)`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(1.15)` }
  ], { duration: slideMs, easing: "cubic-bezier(.6, 0, 1, .7)", fill: "forwards" });

  // css ring has a delay so the boom starts a bit early
  setTimeout(() => {
    kaboom(power[0], target, power[1]);
    shakeTheBoard(power[0], power[2]);
  }, slideMs - 170);

  slide.onfinish = () => {
    sfx.play("crash", power[3]);
    if (victim) {
      const victimEl = target.querySelector(".pc");
      if (victimEl && victimEl !== pieceEl) flyAway(victimEl);
      if (power[3] >= 2) flashBoard();
      shout(pickQuip(CAPTURE_SHOUTS[victim], "shout" + victim), true);
    } else {
      shout(pickQuip(QUIET_SHOUTS, "quiet"), false);
    }

    setTimeout(() => {
      boardAfterMove = afterReply;
      landingSquare = null;
      drawBoard();
      whenDone();
    }, victim ? 1000 : 550);
  };
}

// text

const MOVE_QUIPS = [
  ["Chef's kiss. Total catastrophe!", "Perfectly terrible. I'm moved.", "You found the abyss and moved in.", "Stockfish just left the room.", "A masterpiece of bad judgment.", "Not one piece survived that decision."],
  ["Oof. Your pieces filed a complaint.", "Disaster, with room to grow.", "That move has a lawyer now.", "Your king is updating his resume.", "So close to peak ruin.", "Bold. Wrong. Beautiful."],
  ["Wrong. Confidently wrong, even.", "Wrong, but not wrong enough.", "Bad, but your opponent will survive.", "A very respectable oops.", "Nearly offensive. Nearly.", "Wrong in a way your coach would sigh at."],
  ["Mid-tier mistake. Needs more chaos.", "Too reasonable. Try suffering.", "Your inner coward is showing.", "That move has a pulse. Unacceptable.", "Ew. Structure.", "Almost bad. Almost."],
  ["Ew. That was actually decent.", "Suspiciously good. Are you cheating?", "A grandmaster would be proud. Disgusting.", "You tried to play well, didn't you.", "That's the opposite of the assignment.", "Please stop being good at this."],
  ["Clock ran out. The board got bored.", "The pieces waited. And waited.", "Thinking is not a move.", "Time's up. So is your dignity.", "Even the pawns fell asleep."]
];

// [min share of max score, titles] checked top to bottom
const FINAL_TITLES = [
  [0.85, ["Certified menace", "Agent of chaos", "Chess crimes champion", "Has never once been good at chess (on purpose)", "Stockfish files restraining orders"]],
  [0.65, ["Natural disaster", "Gifted at being terrible", "Grandmaster of the blunder", "A hazard to wooden pieces", "Your pieces fear you"]],
  [0.4,  ["Promising chaos", "Apprentice of ruin", "Chaotic neutral", "Mildly cursed", "Rising star of bad ideas"]],
  [0.15, ["Dangerously competent", "Suspiciously reasonable", "Accidentally decent", "Secretly practicing, aren't you", "Too sensible to be trusted"]],
  [-1e9, ["Disappointingly good at chess", "Ugh, you actually are good", "Stockfish's favourite nephew", "Please go play ranked", "You swore, and it was true"]]
];

// no repeats in a row
const lastQuip = {};
function pickQuip(list, key) {
  let i;
  do {
    i = Math.floor(Math.random() * list.length);
  } while (list.length > 1 && i === lastQuip[key]);
  lastQuip[key] = i;
  return list[i];
}

// capybara + scenery

// capyking.webp: 4 columns x 3 rows
const SHEET_COLS = 4;
const SHEET_ROWS = 3;
const POSES = {
  stand: { row: 0, frames: [0], fps: 1 },
  walk:  { row: 0, frames: [1, 2, 3], fps: 8 },
  run:   { row: 1, frames: [0, 1, 2, 3], fps: 12 },
  sit:   { row: 2, frames: [0, 1, 2, 3], fps: 3 }
};
// sky, hills, ground, bushes
const SCROLL_SPEEDS = [0.06, 0.3, 0.75, 0.75];

const cap = document.getElementById("cap");
const layers = [...document.querySelectorAll("#world .ly")];
let currentPose = "";
let frameNo = 0;
let frameTimer = null;
let scrollSpeed = 0;
const scrollOffsets = [0, 0, 0, 0];

const sheet = new Image();
sheet.onload = () => {
  cap.style.aspectRatio = (sheet.naturalWidth / SHEET_COLS) + "/" + (sheet.naturalHeight / SHEET_ROWS);
};
sheet.src = "assets/capyking.webp";

function setPose(name, flipped) {
  cap.classList.toggle("flip", !!flipped);
  if (name === currentPose) return;

  currentPose = name;
  frameNo = 0;
  clearInterval(frameTimer);

  const pose = POSES[name];
  function drawFrame() {
    const col = pose.frames[frameNo++ % pose.frames.length];
    cap.style.backgroundPosition = `${col / (SHEET_COLS - 1) * 100}% ${pose.row / (SHEET_ROWS - 1) * 100}%`;
  }
  drawFrame();
  frameTimer = setInterval(drawFrame, 1000 / pose.fps);
}

// sky drifts a bit even when standing still
let lastFrameTime = 0;
function scrollLoop(now) {
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000 || 0);
  lastFrameTime = now;
  layers.forEach((layer, i) => {
    const drift = i === 0 ? 5 : 0;
    scrollOffsets[i] -= (scrollSpeed * SCROLL_SPEEDS[i] + drift) * dt;
    layer.style.backgroundPositionX = scrollOffsets[i] + "px";
  });
  requestAnimationFrame(scrollLoop);
}
scrollLoop(0);

// mood = points you just got
function capyMood(mood) {
  if (mood === 0) {
    scrollSpeed = 0;
    setPose("sit", cap.classList.contains("flip"));
  } else if (mood > 0) {
    scrollSpeed = mood >= 50 ? 220 : 110;
    setPose(mood >= 50 ? "run" : "walk", false);
  } else {
    scrollSpeed = -90;
    setPose("walk", true);
  }
}

function showScore(score) {
  const progress = Math.max(0, Math.min(MAX_SCORE, score)) / MAX_SCORE;
  cap.style.left = (8 + 74 * progress) + "%";
  document.getElementById("score").textContent = Math.round(score);

  const fruit = document.getElementById("score-fruit");
  if (!fruit.firstChild) fruit.innerHTML = fruitBasket();
  const lit = Math.round(progress * MAX_FRUIT_SLICES);
  if (fruit.dataset.lit !== String(lit)) {
    fruit.dataset.lit = lit;
    fillYuzu(fruit, lit, score < 0);
    fruit.classList.remove("pop");
    void fruit.offsetWidth;
    fruit.classList.add("pop");
  }
}

function makeYuzu() {
  const slices = [];
  for (let k = 0; k < 8; k++) {
    const a0 = (k * 45 - 90 + 4) * Math.PI / 180;
    const a1 = ((k + 1) * 45 - 90 - 4) * Math.PI / 180;
    const R = 28;
    const x0 = 50 + R * Math.cos(a0), y0 = 52 + R * Math.sin(a0);
    const x1 = 50 + R * Math.cos(a1), y1 = 52 + R * Math.sin(a1);
    slices.push(`<path class="slice" d="M50 52 L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z"/>`);
  }
  return `<svg class="yuzu" viewBox="0 -8 100 112" aria-hidden="true">` +
    `<path class="leaf" d="M50 9 C56 -6 74 -6 82 2 C74 14 58 15 50 9Z"/>` +
    `<circle class="rind" cx="50" cy="52" r="44"/>` +
    `<circle class="pith" cx="50" cy="52" r="33"/>` +
    slices.join("") +
    `<circle class="core" cx="50" cy="52" r="3.5"/>` +
    `<path class="shine" d="M22 38 A32 32 0 0 1 36 22"/></svg>`;
}

function fruitBasket() {
  return `<div class="fruit-row">${makeYuzu()}${makeYuzu()}${makeYuzu()}</div>`;
}

function fillYuzu(root, lit, sour) {
  root.querySelectorAll(".slice").forEach((s, i) => s.classList.toggle("on", i < lit));
  root.classList.toggle("sour", !!sour);
}

const barPercent = v => 50 + 50 * Math.tanh(v / 350);
function formatEval(v) {
  if (Math.abs(v) >= 1000) return (v > 0 ? "+" : "-") + "10+";
  return (v > 0 ? "+" : "") + (v / 100).toFixed(1);
}
function setEvalBar(v) {
  document.getElementById("evalfill").style.height = barPercent(v) + "%";
  document.getElementById("evaltext").textContent = formatEval(v);
}

function showVerdict() {
  const r = scoreboard[roundNo];
  const isLastRound = roundNo === HOW_MANY_ROUNDS - 1;
  const evalBefore = evalBeforeMove();
  const evalAfter = r.move ? squish(r.scores[r.move]) * sideSign(r.fen) : evalBefore;
  const duration = r.move ? 1000 + r.ratio * 2400 : 700;

  const overlay = document.getElementById("overlay");
  overlay.hidden = false;
  overlay.innerHTML =
    `<div class="card t${r.t}">` +
      `<div class="n" id="bignumber">+0</div>` +
      `<div id="result-fruit">${fruitBasket()}</div>` +
      `<div class="quip">${pickQuip(MOVE_QUIPS[r.t], "t" + r.t)}</div>` +
      `<div id="button-spot"></div>` +
    `</div>`;

  const pointsBefore = scoreboard.slice(0, roundNo).reduce((sum, x) => sum + x.points, 0);
  const startedAt = performance.now();
  const shake = r.move ? 2 + r.ratio * 4 : 0;
  const bar = document.querySelector(".evalbar");
  let lastTickStep = -1;

  function tick(now) {
    const k = Math.min(1, (now - startedAt) / duration);
    const eased = Math.pow(k, 1 + 2.5 * r.ratio);

    setEvalBar(evalBefore + (evalAfter - evalBefore) * eased);
    showScore(pointsBefore + r.points * k);
    capyMood(r.points);
    bar.style.transform = k < 1
      ? `translate(${(Math.random() - 0.5) * shake}px,${(Math.random() - 0.5) * shake}px)`
      : "";

    const shown = r.points * k;
    if (r.points !== 0 && Math.floor(k * 14) !== lastTickStep) {
      lastTickStep = Math.floor(k * 14);
      sfx.play("tick", k, r.points);
    }
    document.getElementById("bignumber").textContent = (shown >= 0.5 ? "+" : "") + Math.round(shown);
    fillYuzu(
      document.getElementById("result-fruit"),
      Math.round(Math.max(0, r.points) * k / 100 * MAX_FRUIT_SLICES),
      r.points < 0
    );

    if (k < 1) {
      requestAnimationFrame(tick);
      return;
    }

    sfx.play("sting", r.t);
    showRun();
    showScore(pointsBefore + r.points);
    capyMood(0);
    document.getElementById("button-spot").innerHTML =
      `<button id="next">${isLastRound ? "See results" : "Next round"}</button>`;
    document.getElementById("next").onclick = () => {
      overlay.hidden = true;
      if (isLastRound) showFinalScreen();
      else nextRound();
    };
  }
  tick(startedAt);
}

function nextRound() {
  roundNo++;
  pickedSquare = null;
  frozen = false;
  boardAfterMove = null;
  landingSquare = null;
  glow = {};
  document.getElementById("fx").innerHTML = "";
  document.getElementById("board").classList.remove("shake");
  showRun();

  drawBoard();
  setEvalBar(evalBeforeMove());
  showScore(totalPoints());
  capyMood(0);
  startClock();
}

// badges

function currentRun() {
  let n = 0;
  for (let i = scoreboard.length - 1; i >= 0 && scoreboard[i].points > 0; i--) n++;
  return n;
}

function longestRun() {
  let best = 0;
  let now = 0;
  scoreboard.forEach(r => {
    now = r.points > 0 ? now + 1 : 0;
    best = Math.max(best, now);
  });
  return best;
}

function showRun() {
  const n = currentRun();
  document.getElementById("run").textContent = n >= 2 ? "🔥 " + n + " in a row" : "";
}

// g = what happened this game
const BADGES = [
  { id: "first",   icon: "🐣", name: "First blood",       how: "Finish a game",                               test: g => true },
  { id: "hat",     icon: "🎩", name: "Hat trick",         how: "3 gold (worst) moves in one game",            test: g => g.rounds.filter(r => r.t === 0).length >= 3 },
  { id: "roll",    icon: "🔥", name: "On a roll",         how: "5 rounds in a row that give points",          test: g => g.longestRun >= 5 },
  { id: "quick",   icon: "⚡", name: "Quick draw",        how: "A gold or red move in under 3 seconds",       test: g => g.rounds.some(r => r.move && r.t <= 1 && r.secs < 3) },
  { id: "royal",   icon: "👑", name: "Royal disaster",    how: "Lose your queen to the punishment",           test: g => g.queenLost },
  { id: "zzz",     icon: "😴", name: "Fell asleep",       how: "Run out of time in a round",                  test: g => g.rounds.some(r => r.t === 5) },
  { id: "speed",   icon: "🏎️", name: "Cool under pressure",       how: "400+ points in panic mode",                    test: g => g.fast && g.total >= 400 },
  { id: "grind",   icon: "📅", name: "Daily grind",       how: "Play 3 days in a row",                        test: g => g.dayStreak >= 3 },
  { id: "perfect", icon: "🏆", name: "Perfectly terrible", how: "Score exactly 800",                          test: g => g.total === MAX_SCORE },
  { id: "toogood", icon: "🧠", name: "Too good",          how: "Score exactly -800",                          test: g => g.total === MIN_SCORE },
  { id: "close",   icon: "😅", name: "Cutting it close",  how: "A gold or red move in the last 2 seconds",    test: g => g.rounds.some(r => r.move && r.t <= 1 && r.secs > r.limit - 2) },
  { id: "comeback", icon: "🪃", name: "Comeback kid",     how: "Drop below -100 and still finish above 300",  test: g => g.lowestPoint <= -100 && g.total > 300 }
];

// dev panel can force badges
let forcedBadges = [];

// each badge counts how many games you earned it in, more = rarer
const RARITY_STEPS = [1, 10, 50, 100, 1000];
const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

function rarityLevel(count) {
  let level = -1;
  RARITY_STEPS.forEach((needed, i) => { if (count >= needed) level = i; });
  return level;
}

// old saves only had a date string
function badgeCount(stats, id) {
  const saved = stats.badges && stats.badges[id];
  if (!saved) return 0;
  return typeof saved === "string" ? 1 : saved.count;
}

function drawModeButtons() {
  const btn = document.getElementById("panic");
  btn.disabled = started;
  btn.classList.toggle("on", fastMode);
  btn.setAttribute("aria-pressed", fastMode ? "true" : "false");
  btn.textContent = fastMode ? "😰 PANIC" : "😌 Chill";
  btn.title = fastMode ? "Panic mode: 5 seconds per move" : "Chill mode: 30 seconds per move. Click for panic mode (5 seconds).";
}

function setMode(wantFast) {
  fastMode = wantFast;
  secondsPerMove = fastMode ? SECONDS_FAST : SECONDS_NORMAL;
  try { localStorage.setItem("fastMode", fastMode ? "1" : "0"); } catch (e) {}
  showBest();
  drawModeButtons();
  showClockFull();
}

document.getElementById("panic").onclick = () => {
  if (puzzles.length) setMode(!fastMode);
};

// feast + special endings

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const rand = (a, b) => a + Math.random() * (b - a);

function playSprite(el, poseName) {
  const pose = POSES[poseName];
  let n = 0;
  function drawFrame() {
    const col = pose.frames[n++ % pose.frames.length];
    el.style.backgroundPosition = `${col / (SHEET_COLS - 1) * 100}% ${pose.row / (SHEET_ROWS - 1) * 100}%`;
  }
  drawFrame();
  return setInterval(drawFrame, 1000 / pose.fps);
}

function parkBesidePanel() {
  const gap = document.getElementById("final").getBoundingClientRect().left;
  const width = cap.getBoundingClientRect().width;
  if (gap < width * 1.05) return false;
  cap.style.left = gap / 2 + "px";
  return true;
}

// guessed from the sprite, tweak if it looks off
function mouthSpot() {
  const box = cap.getBoundingClientRect();
  const flipped = cap.classList.contains("flip");
  return {
    x: box.left + box.width * (flipped ? 0.1 : 0.9),
    y: box.top + box.height * 0.4,
    groundY: box.bottom - box.height * 0.08
  };
}

function wiggle(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  el.addEventListener("animationend", () => el.classList.remove(className), { once: true });
}

function dropFruit(good) {
  const spot = mouthSpot();
  const size = 56;
  const fruit = document.createElement("div");
  fruit.className = "flyfruit";
  fruit.innerHTML = makeYuzu();
  fillYuzu(fruit, MAX_FRUIT_SLICES, !good);
  document.body.append(fruit);

  const endX = good ? spot.x : spot.x + rand(-30, 30);
  const endY = good ? spot.y : spot.groundY;
  const startX = endX + rand(-40, 40);

  fruit.animate([
    { transform: `translate(${startX - size / 2}px, -90px) rotate(0deg)`, opacity: 1 },
    { transform: `translate(${endX - size / 2}px, ${endY - size / 2}px) rotate(${rand(-200, 200)}deg)`, opacity: 1 }
  ], { duration: 700, easing: "cubic-bezier(.5, 0, .9, .6)", fill: "forwards" }).onfinish = function () {
    fruit.remove();
    if (good) {
      sfx.play("munch");
      wiggle(cap, "chomp");
    } else {
      sfx.play("splat");
      wiggle(cap, "recoil");
      const puddle = document.createElement("div");
      puddle.className = "splat";
      puddle.style.cssText = `left:${endX}px;top:${endY}px`;
      document.body.append(puddle);
      puddle.animate([
        { transform: "translate(-50%,-50%) scale(.2)", opacity: .9 },
        { transform: "translate(-50%,-50%) scale(1.6, .6)", opacity: 0 }
      ], { duration: 900, easing: "ease-out" }).onfinish = () => puddle.remove();
    }
  };
}

function feast(whenDone) {
  const rounds = scoreboard.filter(r => r.points !== 0);
  if (reducedMotion || !rounds.length) {
    whenDone();
    return;
  }
  window.scrollTo(0, 0);
  setPose("stand", false);
  scrollSpeed = 0;

  rounds.forEach((r, i) => setTimeout(() => dropFruit(r.points > 0), i * 420));
  setTimeout(() => {
    capyMood(0);
    whenDone();
  }, rounds.length * 420 + 800);
}

function showSpecial(kind, total) {
  const gold = kind === "gold";
  const box = document.createElement("div");
  box.id = "special";
  box.className = gold ? "gold" : "gloom";
  box.innerHTML =
    `<div class="rays"></div><div class="skyfx"></div>` +
    `<div class="spcap"></div>` +
    `<div class="spbig">${total}</div>` +
    `<div class="spsub">${gold ? "Perfectly terrible" : "Too good at chess"}</div>` +
    `<p class="spnote">${gold ? "Every single round was the worst move. Stockfish wants a word." : "You found the best move every single time. This was not the assignment."}</p>` +
    `<button id="special-ok">Show my results</button>`;
  document.body.append(box);

  const spcap = box.querySelector(".spcap");
  spcap.style.aspectRatio = cap.style.aspectRatio || "1";
  const spriteTimer = playSprite(spcap, gold ? "run" : "sit");
  const timers = [spriteTimer];
  const sky = box.querySelector(".skyfx");

  if (!reducedMotion) {
    if (gold) {
      for (let i = 0; i < 36; i++) {
        const bit = document.createElement("div");
        bit.className = "confetti";
        bit.innerHTML = makeYuzu();
        fillYuzu(bit, MAX_FRUIT_SLICES, false);
        bit.style.left = rand(0, 100) + "vw";
        sky.append(bit);
        bit.animate([
          { transform: "translateY(-10vh) rotate(0deg)" },
          { transform: `translateY(110vh) rotate(${rand(-540, 540)}deg)` }
        ], { duration: rand(2800, 5000), delay: rand(0, 3000), iterations: Infinity, easing: "linear" });
      }
    } else {
      for (let i = 0; i < 70; i++) {
        const drop = document.createElement("i");
        drop.className = "drop";
        drop.style.left = rand(0, 100) + "vw";
        sky.append(drop);
        drop.animate([
          { transform: "translateY(-10vh)" },
          { transform: "translateY(110vh)" }
        ], { duration: rand(500, 900), delay: rand(0, 900), iterations: Infinity, easing: "linear" });
      }
      for (let i = 0; i < 6; i++) {
        const bit = document.createElement("div");
        bit.className = "confetti";
        bit.innerHTML = makeYuzu();
        fillYuzu(bit, MAX_FRUIT_SLICES, true);
        bit.style.left = rand(5, 95) + "vw";
        sky.append(bit);
        bit.animate([
          { transform: "translateY(-10vh) rotate(0deg)" },
          { transform: `translateY(110vh) rotate(${rand(-200, 200)}deg)` }
        ], { duration: rand(5000, 8000), delay: rand(0, 4000), iterations: Infinity, easing: "linear" });
      }
      const flash = document.createElement("div");
      flash.className = "flash";
      box.append(flash);
      const zap = () => flash.animate(
        [{ opacity: 0 }, { opacity: .9, offset: .1 }, { opacity: 0, offset: .3 }, { opacity: .6, offset: .4 }, { opacity: 0 }],
        { duration: 600 }
      );
      zap();
      timers.push(setInterval(zap, 3200));
    }
  }

  sfx.play(gold ? "gold" : "gloom");
  box.querySelector("#special-ok").onclick = () => {
    timers.forEach(clearInterval);
    box.remove();
  };
}

// final screen

function miniBoard(fen, uci, tier) {
  const { grid, turn } = readFen(fen);
  const flip = turn === "b";
  const from = uci ? uci.slice(0, 2) : "";
  const to = uci ? uci.slice(2, 4) : "";

  let html = '<div class="mini">';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const row = flip ? 7 - r : r;
      const col = flip ? 7 - c : c;
      const name = squareName(row, col);
      const piece = grid[row][col];

      const colour = (row + col) % 2 === 0 ? "l" : "d";
      const marked = name === from || name === to ? " mv t" + tier : "";
      let inside = "";
      if (piece) {
        const side = piece === piece.toUpperCase() ? "w" : "b";
        inside = `<span class="${side}">${PIECE_ICONS[piece.toLowerCase()]}︎</span>`;
      }
      html += `<div class="${colour}${marked}">${inside}</div>`;
    }
  }
  return html + "</div>";
}

function scoreGraph() {
  const totals = [0];
  scoreboard.forEach(r => totals.push(totals[totals.length - 1] + r.points));

  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  const span = (hi - lo) || 1;
  const X = i => 20 + i / HOW_MANY_ROUNDS * 440;
  const Y = v => 140 - (v - lo) / span * 120;

  const line = "M" + totals.map((v, i) => X(i) + " " + Y(v)).join(" L");
  let dots = "";
  totals.forEach((v, i) => {
    if (i === 0) return;
    const delay = (0.3 + i / HOW_MANY_ROUNDS * 2.4).toFixed(2);
    dots += `<circle class="gd t${scoreboard[i - 1].t}" style="animation-delay:${delay}s" cx="${X(i)}" cy="${Y(v)}" r="6"/>`;
  });

  return `<svg class="graph" viewBox="0 0 480 160">` +
    `<line class="zero" x1="20" x2="460" y1="${Y(0)}" y2="${Y(0)}"/>` +
    `<path class="gl" pathLength="1" d="${line}"/>` + dots + `</svg>`;
}

function drawShelf(stats, earnedNow) {
  const badges = stats.badges || {};
  document.getElementById("statline").textContent =
    "🔥 Day streak: " + (stats.dayStreak || 1) + " · Longest run: " + (stats.bestRun || 0);
  document.getElementById("shelf-title").textContent =
    "Badges " + BADGES.filter(b => badgeCount(stats, b.id) > 0).length + "/" + BADGES.length;

  document.getElementById("shelf").innerHTML = BADGES.map(b => {
    const count = badgeCount(stats, b.id);
    const level = rarityLevel(count);
    const thisGame = earnedNow.find(e => e.badge === b);
    const isNew = thisGame && thisGame.before === 0;
    const next = RARITY_STEPS[level + 1];
    const counter = next ? `${count}/${next}` : `${count}`;

    if (!count) {
      return `<div class="badge-chip"><span class="count">0/${RARITY_STEPS[0]}</span>` +
        `<span class="bi">🔒</span><b>${b.name}</b><small>${b.how}</small></div>`;
    }
    const again = thisGame && !isNew;
    return `<div class="badge-chip got r${level}${isNew ? " new" : ""}${again ? " again" : ""}">` +
      `<span class="count">${counter}</span>` +
      `<span class="bi">${b.icon}</span><b>${b.name}</b>` +
      `<span class="rarity">${RARITY_NAMES[level]}</span>` +
      `<small>${b.how}</small>${again ? "<i class=\"plus\">+1</i>" : ""}</div>`;
  }).join("");
}

function showFinalScreen() {
  clearInterval(clockTimer);
  const total = totalPoints();
  const share = total / MAX_SCORE;
  const band = FINAL_TITLES.find(b => share >= b[0]);
  const title = pickQuip(band[1], "final");

  const oldBest = readBest();
  const isNewBest = oldBest === null || total > oldBest;
  if (isNewBest && savingScores) saveBest(total);
  const modeName = fastMode ? " (panic mode)" : "";
  const bestLine = isNewBest
    ? `<p class="bestline new">New best score${modeName}!</p>`
    : `<p class="bestline">Your best${modeName}: ${oldBest}</p>`;

  const stats = readStats();
  stats.badges = stats.badges || {};
  if (stats.lastDay !== dayString(0)) {
    stats.dayStreak = stats.lastDay === dayString(-1) ? (stats.dayStreak || 0) + 1 : 1;
    stats.lastDay = dayString(0);
  }
  const run = longestRun();
  if (run > (stats.bestRun || 0)) stats.bestRun = run;

  let running = 0;
  let lowestPoint = 0;
  scoreboard.forEach(r => {
    running += r.points;
    lowestPoint = Math.min(lowestPoint, running);
  });

  const gameSummary = { total: total, rounds: scoreboard, fast: fastMode, longestRun: run, lowestPoint: lowestPoint, dayStreak: stats.dayStreak || 1, queenLost: queenLost };

  const earnedNow = BADGES.filter(b => b.test(gameSummary) || forcedBadges.includes(b.id)).map(b => {
    const before = badgeCount(stats, b.id);
    const saved = stats.badges[b.id];
    const firstDay = typeof saved === "string" ? saved : saved ? saved.first : dayString(0);
    stats.badges[b.id] = { first: firstDay, count: before + 1 };
    return { badge: b, before: before, after: before + 1 };
  });
  if (savingScores) writeStats(stats);

  const announcements = [];
  earnedNow.forEach(e => {
    if (e.before === 0) {
      announcements.push(`New badge: ${e.badge.icon} ${e.badge.name}!`);
    } else if (rarityLevel(e.after) > rarityLevel(e.before)) {
      announcements.push(`${e.badge.icon} ${e.badge.name} is now ${RARITY_NAMES[rarityLevel(e.after)]}!`);
    }
  });
  const newBadgeLines = announcements.map(text => `<p class="bestline new">${text}</p>`).join("");

  document.getElementById("game").hidden = true;
  document.querySelector("main").classList.add("summary");
  const final = document.getElementById("final");
  final.hidden = false;

  let rows = "";
  scoreboard.forEach((r, i) => {
    rows +=
      `<div class="row t${r.t}">${miniBoard(r.fen, r.move, r.t)}` +
        `<div><span class="badge">${TIER_NAMES[r.t]}</span>` +
        `<p style="margin:8px 0 0">${prettyMove(r.fen, r.move)}</p>` +
        `<button class="ghost" data-i="${i}" style="margin-top:8px">Solutions</button></div>` +
        `<b style="color:var(--tc);font-size:1.4rem">${r.points}</b></div>` +
      `<ul class="sol" id="sol${i}" hidden></ul>`;
  });

  final.innerHTML =
    `<div class="big">${total}<span style="font-size:1.2rem;color:var(--mu)"> / ${MAX_SCORE}</span></div>` +
    `<p style="font-size:1.4rem;font-weight:800;margin:6px 0 4px">${title}</p>` + bestLine + newBadgeLines + `<p class="bestline" id="statline"></p>` +
    `<div id="final-fruit">${fruitBasket()}</div>` +
    scoreGraph() +
    `<h3 class="shelf-title" id="shelf-title"></h3><div class="shelf" id="shelf"></div>` + rows +
    `<p style="margin-top:24px"><button id="again">Play again</button></p>`;

  drawShelf(stats, earnedNow);
  fillYuzu(document.getElementById("final-fruit"), Math.round(Math.max(0, Math.min(1, share)) * MAX_FRUIT_SLICES), total < 0);

  final.querySelectorAll("[data-i]").forEach(btn => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      const list = document.getElementById("sol" + i);
      const r = scoreboard[i];

      if (!list.innerHTML) {
        const ranked = Object.keys(r.scores).sort((a, b) =>
          squish(r.scores[a]) - squish(r.scores[b]) || r.scores[a] - r.scores[b]
        );
        list.innerHTML = ranked.map(m => {
          const x = judgeMove(m, r.scores);
          const isYou = m === r.move;
          return `<li class="t${x.t}${isYou ? " you" : ""}">` +
            `<span>${prettyMove(r.fen, m)}${isYou ? " ← you" : ""}</span><span>${x.points}</span></li>`;
        }).join("");
      }
      list.hidden = !list.hidden;
      btn.textContent = list.hidden ? "Solutions" : "Hide solutions";
    };
  });

  document.getElementById("again").onclick = () => location.reload();

  const special = total === MAX_SCORE ? "gold" : total === MIN_SCORE ? "gloom" : null;
  if (!parkBesidePanel() && !reducedMotion) final.classList.add("feasting");
  setTimeout(() => {
    feast(() => {
      final.classList.remove("feasting");
      if (special) showSpecial(special, total);
      else sfx.play("jingle");
      if (announcements.length) setTimeout(() => sfx.play("badge"), 600);
    });
  }, 600);
}

// start

async function loadPuzzles() {
  try {
    const response = await fetch("positions.json");
    puzzles = await response.json();
    puzzles.sort(() => Math.random() - 0.5);  // not a perfect shuffle but fine

    drawBoard();
    setEvalBar(evalBeforeMove());
    showScore(0);
    showBest();
    showRun();
    capyMood(0);
    showClockFull();
  } catch (err) {
    document.getElementById("status").textContent =
      "Could not load positions.json. Run a local server or check the file is next to index.html.";
    console.error(err);
  }
}
loadPuzzles();

const muteButton = document.getElementById("mute");
muteButton.textContent = sfx.isMuted() ? "🔇" : "🔊";
muteButton.onclick = () => {
  const nowMuted = sfx.toggle();
  muteButton.textContent = nowMuted ? "🔇" : "🔊";
};
document.addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (btn && btn.id !== "mute") sfx.play("ui");
});

document.getElementById("play").onclick = () => {
  if (puzzles.length) startGame();
};