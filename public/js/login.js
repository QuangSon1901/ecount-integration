const loginForm = document.getElementById('loginForm');
const btnLogin = document.getElementById('btnLogin');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const alertBox = document.getElementById('alertBox');

function showAlert(message, type = 'error') {
  alertBox.textContent = message;
  alertBox.className = `alert ${type}`;
  alertBox.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => {
      alertBox.style.display = 'none';
    }, 3000);
  }
}

function hideAlert() {
  alertBox.style.display = 'none';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  if (!username || !password) {
    showAlert('Vui lòng nhập đầy đủ thông tin');
    return;
  }

  // Loading state
  btnLogin.disabled = true;
  spinner.style.display = 'inline-block';
  btnText.textContent = 'Đang xử lý...';

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showAlert('Đăng nhập thành công! Đang chuyển hướng...', 'success');

      // Redirect after 500ms
      setTimeout(() => {
        window.location.href = data.data.redirectUrl || '/extensions/dashboard';
      }, 500);
    } else {
      showAlert(data.message || 'Đăng nhập thất bại');
      btnLogin.disabled = false;
      spinner.style.display = 'none';
      btnText.textContent = 'Đăng Nhập';
    }
  } catch (err) {
    console.error('Login error:', err);
    showAlert('Lỗi kết nối. Vui lòng thử lại.');
    btnLogin.disabled = false;
    spinner.style.display = 'none';
    btnText.textContent = 'Đăng Nhập';
  }
});

// Auto-focus username field
document.getElementById('username').focus();