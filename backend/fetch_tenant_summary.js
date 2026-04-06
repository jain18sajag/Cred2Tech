async function test() {
  const login = await fetch('http://localhost:5000/auth/login', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ email: 'superadmin@credm.com', password: 'superadmin123' })
  });
  const data = await login.json();
  
  if (!data.token) {
     console.error("Login failed", data);
     return;
  }

  const res = await fetch('http://localhost:5000/admin/tenants/5/summary', {
     headers: { Authorization: `Bearer ${data.token}` }
  });
  console.log(res.status, await res.text());
}
test();
