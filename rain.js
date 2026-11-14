// Falling chess pieces in the background. Some shatter when they land.
(function () {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.getElementById("rain");
  const SYMBOLS = ["♔", "♕", "♖", "♗", "♘", "♙", "♚", "♛", "♜", "♝", "♞", "♟"];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function shatter(x, size, blur) {
    for (let i = 0; i < 7; i++) {
      const shard = document.createElement("i");
      const w = rnd(6, size / 3);
      shard.className = "shard";
      shard.style.cssText = `left:calc(${x}vw + ${rnd(0, size * 0.6)}px);width:${w}px;height:${w * 1.2}px;filter:blur(${blur}px)`;
      layer.append(shard);

      const dx = rnd(-90, 90);
      const up = rnd(40, 140);
      shard.animate([
        { transform: "translate(0,0) rotate(0deg)", opacity: 0.6 },
        { transform: `translate(${dx * 0.5}px,${-up}px) rotate(${rnd(-200, 200)}deg)`, opacity: 0.5, offset: 0.45 },
        { transform: `translate(${dx}px,${rnd(0, 30)}px) rotate(${rnd(-400, 400)}deg)`, opacity: 0 }
      ], { duration: rnd(700, 1200), easing: "ease-out" }).onfinish = () => shard.remove();
    }
  }

  function drop() {
    if (document.hidden || layer.children.length > 40) return;

    const piece = document.createElement("span");
    const size = rnd(26, 90);
    const x = rnd(2, 96);
    const blur = rnd(0.5, 3.5);
    const breaks = Math.random() < 0.45;

    piece.className = "fall";
    piece.textContent = SYMBOLS[Math.floor(rnd(0, SYMBOLS.length))] + "\uFE0E";
    piece.style.cssText = `left:${x}vw;font-size:${size}px;filter:blur(${blur}px)`;
    layer.append(piece);

    // Pieces that break stop at the bottom edge, the others fall off screen
    const end = breaks ? `calc(100vh - ${size}px)` : "115vh";
    piece.animate([
      { transform: "translateY(-15vh) rotate(0deg)" },
      { transform: `translateY(${end}) rotate(${rnd(-300, 300)}deg)` }
    ], { duration: rnd(6000, 12000), easing: "cubic-bezier(.45,0,.9,.7)" }).onfinish = () => {
      piece.remove();
      if (breaks) shatter(x, size, blur);
    };
  }

  setInterval(drop, 850);
  for (let i = 0; i < 4; i++) setTimeout(drop, i * 500);
})();