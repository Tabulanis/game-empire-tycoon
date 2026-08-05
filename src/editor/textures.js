/**
 * @file textures.js
 * @description Built-in generic textures for the Kit Bay's texture palette —
 * drawn procedurally on a canvas at load, so they ship as code, not assets
 * (Constitution: complete in the box, CC0-only bundling stays trivially true
 * for things we generate ourselves). Each entry mirrors the shape of a
 * cartridge sprite reference: {id, name, dataURL}.
 */

/** @param {number} size @param {(ctx: CanvasRenderingContext2D) => void} draw */
function makeTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  return canvas.toDataURL('image/png');
}

/** Deterministic tiny PRNG so the noisy textures look the same every boot. */
function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GENERIC_TEXTURES = [
  {
    id: 'gen-checker', name: 'Checker',
    dataURL: makeTexture(64, (ctx) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#c7d0de' : '#3b4a63';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    })
  },
  {
    id: 'gen-bricks', name: 'Bricks',
    dataURL: makeTexture(64, (ctx) => {
      ctx.fillStyle = '#8a4a3a'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#a85a44';
      for (let row = 0; row < 8; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 5; col++) ctx.fillRect(col * 16 + off + 1, row * 8 + 1, 14, 6);
      }
    })
  },
  {
    id: 'gen-planks', name: 'Wood',
    dataURL: makeTexture(64, (ctx) => {
      const rand = mulberry(7);
      for (let p = 0; p < 4; p++) {
        ctx.fillStyle = ['#7a5230', '#6d4828', '#835a36', '#71502e'][p];
        ctx.fillRect(p * 16, 0, 16, 64);
        ctx.strokeStyle = 'rgba(40,24,12,0.5)';
        for (let g = 0; g < 5; g++) {
          ctx.beginPath();
          const x = p * 16 + 2 + rand() * 12;
          ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 3, 20, x - 3, 44, x + 2, 64);
          ctx.stroke();
        }
      }
    })
  },
  {
    id: 'gen-stone', name: 'Stone',
    dataURL: makeTexture(64, (ctx) => {
      const rand = mulberry(13);
      ctx.fillStyle = '#8a8f99'; ctx.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 220; i++) {
        const g = 110 + Math.floor(rand() * 60);
        ctx.fillStyle = 'rgb(' + g + ',' + (g + 4) + ',' + (g + 10) + ')';
        ctx.fillRect(Math.floor(rand() * 64), Math.floor(rand() * 64), 1 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 4));
      }
    })
  },
  {
    id: 'gen-dots', name: 'Dots',
    dataURL: makeTexture(64, (ctx) => {
      ctx.fillStyle = '#f0c463'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#e05a72';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        ctx.beginPath();
        ctx.arc(x * 16 + 8 + (y % 2 ? 8 : 0), y * 16 + 8, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    })
  },
  {
    id: 'gen-grid', name: 'Grid',
    dataURL: makeTexture(64, (ctx) => {
      ctx.fillStyle = '#1e1b2e'; ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = '#7cc6ff'; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * 16 + 0.5, 0); ctx.lineTo(i * 16 + 0.5, 64); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * 16 + 0.5); ctx.lineTo(64, i * 16 + 0.5); ctx.stroke();
      }
    })
  },
  {
    id: 'gen-stripes', name: 'Stripes',
    dataURL: makeTexture(64, (ctx) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#ffcf6e' : '#241d0d';
        ctx.fillRect(i * 8, 0, 8, 64);
      }
    })
  },
  {
    id: 'gen-camo', name: 'Camo',
    dataURL: makeTexture(64, (ctx) => {
      const rand = mulberry(29);
      ctx.fillStyle = '#5c6b3c'; ctx.fillRect(0, 0, 64, 64);
      const colors = ['#3f4d28', '#77854c', '#2c351c'];
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = colors[i % 3];
        ctx.beginPath();
        ctx.ellipse(rand() * 64, rand() * 64, 6 + rand() * 10, 4 + rand() * 7, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    })
  }
];
