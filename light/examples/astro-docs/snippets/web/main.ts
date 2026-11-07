const arms = 6; // try 8, or 12
const depth = 3; // how often each branch branches again

const canvas = document.querySelector<HTMLCanvasElement>('#flake')!;
const g = canvas.getContext('2d')!;
const size = Math.min(innerWidth, innerHeight) - 16;
canvas.style.width = canvas.style.height = `${size}px`;
canvas.width = canvas.height = size * devicePixelRatio;
g.scale(devicePixelRatio, devicePixelRatio);
g.translate(size / 2, size / 2);
g.strokeStyle = '#c93f26';
g.lineCap = 'round';

/** Draws a branch up from the origin, with smaller branches off it. */
function branch(length: number, level: number): void {
  g.lineWidth = 1 + level;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -length);
  g.stroke();
  if (level === 0) return;
  for (const along of [0.45, 0.75]) {
    for (const turn of [-1, 1]) {
      g.save();
      g.translate(0, -length * along);
      g.rotate((turn * Math.PI) / 3);
      branch(length * 0.38, level - 1);
      g.restore();
    }
  }
}

for (let arm = 0; arm < arms; arm++) {
  g.save();
  g.rotate((arm * 2 * Math.PI) / arms);
  branch(size * 0.45, depth);
  g.restore();
}
console.log(`drew ${arms} arms, ${depth} levels deep`);
