import p5 from 'p5';

new p5((p: p5) => {
  const flakes = Array.from({ length: 60 }, (_, i) => ({ x: (i * 97) % 400, y: (i * 53) % 300, r: 2 + (i % 4) }));

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noStroke();
    console.log(`snowing ${flakes.length} flakes`);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(20, 23, 28);
    p.fill(255, 255, 255, 200);
    for (const flake of flakes) {
      flake.y = (flake.y + flake.r * 0.4) % p.height;
      flake.x += Math.sin((p.frameCount + flake.y) / 40) * 0.3;
      // The mouse pushes the snow away.
      const away = flake.x - p.mouseX;
      if (Math.abs(away) < 40 && Math.abs(flake.y - p.mouseY) < 40) flake.x += Math.sign(away) * 2;
      p.circle((flake.x + p.width) % p.width, flake.y, flake.r * 2);
    }
  };
});
