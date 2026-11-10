// Runs in the browser. For now it only checks that the server answers.
const status = document.getElementById('server-status');

fetch('/api/health')
  .then((res) => res.json())
  .then((data) => {
    status.textContent = data.ok ? 'Server connected.' : 'Server answered, but something is off.';
  })
  .catch(() => {
    status.textContent = 'Could not reach the server.';
  });
