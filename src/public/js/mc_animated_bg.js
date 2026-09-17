/**
 * E4ALL — Minecraft.net Animated Background System
 * Simulates the night cherry blossom biome with floating petals,
 * twinkling stars, and atmospheric torchlight glow.
 */

class MinecraftAnimatedBackground {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.petals = [];
    this.stars = [];
    this.fireflies = [];
    this.animId = null;
    this.lastTime = 0;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  init() {
    // Create or locate canvas
    let canvas = document.getElementById('mcAnimatedCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'mcAnimatedCanvas';
      canvas.className = 'mc-animated-canvas';
      document.body.prepend(canvas);
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.initStars();
    this.initPetals();
    this.initFireflies();

    this.animate = this.animate.bind(this);
    this.animId = requestAnimationFrame(this.animate);
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  initStars() {
    this.stars = [];
    const count = Math.floor((this.width * this.height) / 8000);
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * (this.height * 0.45), // Top night sky
        size: Math.random() < 0.8 ? 2 : 3,
        alpha: 0.2 + Math.random() * 0.8,
        twinkleSpeed: 0.01 + Math.random() * 0.03,
        twinklePhase: Math.random() * Math.PI * 2
      });
    }
  }

  initPetals() {
    this.petals = [];
    const count = Math.min(45, Math.floor(this.width / 30));
    const colors = ['#f4a6cf', '#e28ab9', '#fbb6db', '#d973a8'];

    for (let i = 0; i < count; i++) {
      this.petals.push({
        x: Math.random() * (this.width + 100) - 50,
        y: Math.random() * this.height,
        size: 4 + Math.floor(Math.random() * 5),
        speedY: 0.5 + Math.random() * 0.9,
        speedX: -0.6 - Math.random() * 0.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        angle: Math.random() * Math.PI * 2,
        angularSpeed: (Math.random() - 0.5) * 0.03,
        oscillationSpeed: 0.02 + Math.random() * 0.03,
        oscillationAmp: 0.8 + Math.random() * 1.2,
        oscillationPhase: Math.random() * Math.PI * 2
      });
    }
  }

  initFireflies() {
    this.fireflies = [];
    const count = 18;
    for (let i = 0; i < count; i++) {
      this.fireflies.push({
        x: Math.random() * this.width,
        y: this.height * 0.5 + Math.random() * (this.height * 0.5),
        radius: 2 + Math.random() * 2,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: (Math.random() - 0.5) * 0.3,
        alpha: Math.random(),
        pulseSpeed: 0.02 + Math.random() * 0.03
      });
    }
  }

  animate(time) {
    if (!document.body.classList.contains('theme-mcnet')) {
      // If classic theme active, skip canvas rendering
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.animId = requestAnimationFrame(this.animate);
      return;
    }

    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. Draw Twinkling Stars
    for (const star of this.stars) {
      star.twinklePhase += star.twinkleSpeed;
      const curAlpha = 0.3 + 0.7 * Math.abs(Math.sin(star.twinklePhase));
      this.ctx.fillStyle = `rgba(255, 255, 255, ${curAlpha * star.alpha})`;
      // Minecraft pixelated stars
      this.ctx.fillRect(Math.floor(star.x), Math.floor(star.y), star.size, star.size);
    }

    // 2. Draw Falling Cherry Blossom Petals
    for (const p of this.petals) {
      p.y += p.speedY;
      p.oscillationPhase += p.oscillationSpeed;
      p.x += p.speedX + Math.sin(p.oscillationPhase) * p.oscillationAmp;
      p.angle += p.angularSpeed;

      // Wrap around
      if (p.y > this.height + 10) {
        p.y = -10;
        p.x = Math.random() * (this.width + 100) - 50;
      }
      if (p.x < -30) {
        p.x = this.width + 20;
      }

      this.ctx.save();
      this.ctx.translate(Math.floor(p.x), Math.floor(p.y));
      this.ctx.rotate(p.angle);
      this.ctx.fillStyle = p.color;
      // Pixelated petal shape
      this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
      this.ctx.restore();
    }

    // 3. Draw Ambient Firefly Glows
    for (const f of this.fireflies) {
      f.x += f.speedX;
      f.y += f.speedY;
      f.alpha += f.pulseSpeed;

      if (f.x < 0) f.x = this.width;
      if (f.x > this.width) f.x = 0;
      if (f.y < this.height * 0.4) f.y = this.height;
      if (f.y > this.height) f.y = this.height * 0.4;

      const glowAlpha = 0.2 + 0.6 * Math.abs(Math.sin(f.alpha));
      this.ctx.fillStyle = `rgba(180, 255, 120, ${glowAlpha})`;
      this.ctx.fillRect(Math.floor(f.x), Math.floor(f.y), 3, 3);
    }

    this.animId = requestAnimationFrame(this.animate);
  }
}

// Global initialization
window.mcAnimatedBg = new MinecraftAnimatedBackground();
document.addEventListener('DOMContentLoaded', () => {
  window.mcAnimatedBg.init();
});
