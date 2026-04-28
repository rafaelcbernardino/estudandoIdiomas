// Landing page interactions
document.querySelectorAll('.lang-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 12;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 12;
    card.style.transform = `translateY(-12px) scale(1.02) rotateX(${-y}deg) rotateY(${x}deg)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});
