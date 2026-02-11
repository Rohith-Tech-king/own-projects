const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

/* ================= SETUP ================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

app.use(session({
  secret: "enterprise_hr_secret_key",
  resave: false,
  saveUninitialized: false
}));

/* ================= FILE UPLOAD ================= */

if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

const storage = multer.diskStorage({
  destination: "./uploads",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

/* ================= DATABASE ================= */

const db = new sqlite3.Database("employees.db");

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      role TEXT,
      department TEXT,
      salary REAL,
      attendance TEXT DEFAULT 'Present',
      photo TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT
    )
  `);

  const createUser = async (username, password, role) => {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      "INSERT OR IGNORE INTO users (username,password,role) VALUES (?,?,?)",
      [username, hash, role]
    );
  };

  createUser("admin", "admin123", "admin");
  createUser("staff", "staff123", "staff");
});

/* ================= AUTH ================= */

function isAuth(req, res, next) {
  if (!req.session.user) return res.status(401).send("Unauthorized");
  next();
}

function isAdmin(req, res, next) {
  if (req.session.user.role !== "admin")
    return res.status(403).send("Forbidden");
  next();
}

/* ================= LOGIN ================= */

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get("SELECT * FROM users WHERE username=?", [username], async (err, user) => {
    if (!user) return res.json({ success: false });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false });

    req.session.user = { role: user.role };
    res.json({ success: true, role: user.role });
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/* ================= EMPLOYEE API ================= */

app.get("/api/employees", isAuth, (req, res) => {
  db.all("SELECT * FROM employees", [], (err, rows) => res.json(rows));
});

app.post("/api/employees", isAuth, isAdmin, upload.single("photo"), (req, res) => {
  const { name, email, role, department, salary } = req.body;
  const photo = req.file ? req.file.filename : "";

  db.run(
    "INSERT INTO employees (name,email,role,department,salary,photo) VALUES (?,?,?,?,?,?)",
    [name, email, role, department, salary, photo],
    () => res.json({ success: true })
  );
});

app.put("/api/attendance/:id", isAuth, isAdmin, (req, res) => {
  db.run(
    "UPDATE employees SET attendance=? WHERE id=?",
    [req.body.status, req.params.id],
    () => res.json({ success: true })
  );
});

app.delete("/api/employees/:id", isAuth, isAdmin, (req, res) => {
  db.run("DELETE FROM employees WHERE id=?", [req.params.id],
    () => res.json({ success: true }));
});

/* ================= ENTERPRISE UI ================= */

app.get("/", (req, res) => {
res.send(`<!DOCTYPE html>
<html>
<head>
<title>STR Groups | Enterprise HR</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{margin:0;font-family:Arial;background:#f4f6f9}
.header{background:#0f172a;color:white;padding:15px 30px;display:flex;justify-content:space-between}
.logo{font-weight:bold;color:#38bdf8}
.container{padding:30px}
.card{background:white;padding:20px;margin-bottom:20px;border-radius:10px;box-shadow:0 4px 10px rgba(0,0,0,0.05)}
button{padding:8px 14px;border:none;border-radius:6px;cursor:pointer}
.primary{background:#2563eb;color:white}
.danger{background:#dc2626;color:white}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;border-bottom:1px solid #ddd}
img{width:40px;height:40px;border-radius:50%}
.hidden{display:none}
.login{width:300px;margin:150px auto;background:white;padding:30px;border-radius:10px;text-align:center}
</style>
</head>
<body>

<div id="loginPage" class="login">
<h2>STR Groups HR</h2>
<input id="username" placeholder="Username"><br><br>
<input id="password" type="password" placeholder="Password"><br><br>
<button class="primary" onclick="login()">Login</button>
</div>

<div id="app" class="hidden">
<div class="header">
<div class="logo">STR Groups Enterprise HR Dashboard</div>
<button class="danger" onclick="logout()">Logout</button>
</div>

<div class="container">

<div class="card">
<h3>Add Employee</h3>
<form id="empForm">
<input name="name" placeholder="Name" required>
<input name="email" placeholder="Email" required>
<input name="role" placeholder="Role" required>
<input name="department" placeholder="Department" required>
<input name="salary" type="number" placeholder="Salary" required>
<input name="photo" type="file">
<button class="primary">Save</button>
</form>
</div>

<div class="card">
<input id="search" placeholder="Search..." oninput="loadEmployees()">
<button onclick="exportCSV()">Export CSV</button>
</div>

<div class="card">
<canvas id="chart"></canvas>
</div>

<table>
<thead>
<tr>
<th>Photo</th><th>Name</th><th>Email</th><th>Role</th>
<th>Dept</th><th>Salary</th><th>Attendance</th><th>Action</th>
</tr>
</thead>
<tbody id="employees"></tbody>
</table>

</div>
</div>

<script>
let userRole=null;
let chart;
let allData=[];

async function login(){
const res=await fetch('/login',{method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:username.value,password:password.value})});
const d=await res.json();
if(d.success){
userRole=d.role;
loginPage.classList.add("hidden");
app.classList.remove("hidden");
loadEmployees();
}else alert("Invalid Login");
}

async function logout(){
await fetch('/logout',{method:'POST'});
location.reload();
}

async function loadEmployees(){
const res=await fetch('/api/employees');
allData=await res.json();
const q=search.value.toLowerCase();
let filtered=allData.filter(e=>e.name.toLowerCase().includes(q));
employees.innerHTML="";
const deptStats={};
filtered.forEach(e=>{
deptStats[e.department]=(deptStats[e.department]||0)+1;
employees.innerHTML+=\`
<tr>
<td>\${e.photo?'<img src="/uploads/'+e.photo+'">':''}</td>
<td>\${e.name}</td>
<td>\${e.email}</td>
<td>\${e.role}</td>
<td>\${e.department}</td>
<td>$\${e.salary}</td>
<td>\${e.attendance}</td>
<td>\${userRole==="admin"?'<button class="danger" onclick="delEmp('+e.id+')">Delete</button>':'View'}</td>
</tr>\`;
});
drawChart(deptStats);
}

function drawChart(data){
const ctx=document.getElementById("chart");
if(chart) chart.destroy();
chart=new Chart(ctx,{type:'bar',
data:{labels:Object.keys(data),
datasets:[{label:'Employees by Dept',data:Object.values(data),backgroundColor:'#2563eb'}]}});
}

document.getElementById("empForm").addEventListener("submit",async function(e){
e.preventDefault();
const formData=new FormData(this);
await fetch('/api/employees',{method:'POST',body:formData});
this.reset();
loadEmployees();
});

async function delEmp(id){
if(!confirm("Delete?"))return;
await fetch('/api/employees/'+id,{method:'DELETE'});
loadEmployees();
}

function exportCSV(){
let csv="Name,Email,Role,Department,Salary,Attendance\\n";
allData.forEach(e=>{
csv+=\`\${e.name},\${e.email},\${e.role},\${e.department},\${e.salary},\${e.attendance}\\n\`;
});
const blob=new Blob([csv],{type:'text/csv'});
const link=document.createElement("a");
link.href=URL.createObjectURL(blob);
link.download="employees.csv";
link.click();
}
</script>

</body>
</html>`);
});

app.listen(PORT,()=>console.log("🚀 STR Groups Enterprise HR running at http://localhost:"+PORT));
