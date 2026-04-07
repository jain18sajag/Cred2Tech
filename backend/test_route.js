async function test() {
  try {
     const login = await fetch('http://localhost:5000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'superadmin@creddev.com', password: 'superadmin123' })
     });
     const data = await login.json();
     if (!data.token) {
        console.log("No token", data);
        return;
     }
     
     const res = await fetch('http://localhost:5000/admin/lenders/parameters/master', {
        headers: { Authorization: `Bearer ${data.token}` }
     });
     console.log("Status:", res.status);
     console.log(await res.json());
  } catch(e) {
     console.error("Fetch crashed:", e);
  }
}
test();
