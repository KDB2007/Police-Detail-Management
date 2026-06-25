document.addEventListener('DOMContentLoaded', function() {
  // Close modals on escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.fixed.inset-0.z-50').forEach(m => m.classList.add('hidden'));
    }
  });

  // Auto-hide alerts after 5s
  document.querySelectorAll('.bg-red-50, .bg-green-50').forEach(el => {
    if (el.querySelector('[class*="fa-circle-exclamation"]') || el.querySelector('[class*="fa-check-circle"]')) {
      setTimeout(() => { el.style.transition = 'opacity 0.5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 5000);
    }
  });

  // Format currency on invoice pages
  document.querySelectorAll('.currency').forEach(el => {
    const val = parseFloat(el.textContent.replace(/[^0-9.-]/g, ''));
    if (!isNaN(val)) el.textContent = '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  });
});
