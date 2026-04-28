// Floating particle system for background
(function () {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let particles = [];
  let W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function createParticle() {
    const size = Math.random() * 4 + 1;
    const isAccent = Math.random() < 0.3;
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      size,
      speedX: (Math.random() - 0.5) * 0.4,
      speedY: -Math.random() * 0.5 - 0.2,
      opacity: Math.random() * 0.5 + 0.1,
      color: isAccent ? '#A6E312' : '#7411A0',
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.02 + 0.01,
    };
  }

  function init() {
    particles = Array.from({ length: 60 }, createParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    particles.forEach(p => {
      p.pulse += p.pulseSpeed;
      const alpha = p.opacity * (0.7 + 0.3 * Math.sin(p.pulse));

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();

      p.x += p.speedX;
      p.y += p.speedY;

      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); init(); });
  resize();
  init();
  draw();
})();
