const express = require('express');
const session = require('express-session');
const fs = require('fs');
const twilio = require('twilio');
const app = express();

// --- CONFIGURATION (Change these) ---
const ADMIN_USER = "admin";
const ADMIN_PASS = "supersecret";
const PORT = process.env.PORT || 3000;

// Twilio Credentials (Get from twilio.com)
const TWILIO_SID = 'YOUR_ACCOUNT_SID'; 
const TWILIO_TOKEN = 'YOUR_AUTH_TOKEN';
const TWILIO_NUM = 'YOUR_TWILIO_PHONE_NUMBER'; 

const client = (TWILIO_SID !== 'YOUR_ACCOUNT_SID') ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;
const HISTORY_FILE = './history.json';
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'private-key', resave: false, saveUninitialized: true }));

// --- ROUTES ---

// 1. LOGIN PAGE
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#1a1a2e; color:white; display:flex; justify-content:center; align-items:center; height:100vh;">
            <form action="/login" method="POST" style="background:#16213e; padding:30px; border-radius:10px;">
                <h2>Admin Login</h2>
                <input type="text" name="user" placeholder="Username" required style="display:block; width:100%; margin-bottom:10px; padding:10px;">
                <input type="password" name="pass" placeholder="Password" required style="display:block; width:100%; margin-bottom:10px; padding:10px;">
                <button type="submit" style="width:100%; padding:10px; background:#e94560; color:white; border:none; cursor:pointer;">Login</button>
            </form>
        </body>
    `);
});

app.post('/login', (req, res) => {
    if (req.body.user === ADMIN_USER && req.body.pass === ADMIN_PASS) {
        req.session.loggedIn = true;
        res.redirect('/dashboard');
    } else { res.send("Fail. <a href='/'>Retry</a>"); }
});

// 2. ADMIN DASHBOARD
app.get('/dashboard', (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/');
    res.send(`
        <html>
        <head>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <style>
                body { margin:0; display:flex; font-family:sans-serif; }
                #side { width:300px; background:#2c3e50; color:white; padding:20px; height:100vh; overflow-y:auto; }
                #map { flex:1; height:100vh; }
                input, button { width:100%; padding:10px; margin-top:10px; border-radius:5px; border:none; }
                button { background:#1abc9c; color:white; cursor:pointer; }
                .log { font-size:12px; background:#34495e; padding:10px; margin-top:5px; }
            </style>
        </head>
        <body>
            <div id="side">
                <h3>Target Tracking</h3>
                <input type="text" id="phone" placeholder="Friend's Phone (e.g. +91...)">
                <button onclick="sendSMS()">Send Tracking Link</button>
                <hr>
                <h4>Live History</h4>
                <div id="history"></div>
                <a href="/logout" style="color:#e74c3c;">Logout</a>
            </div>
            <div id="map"></div>
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>
                var map = L.map('map').setView([20,0], 2);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                var marker;

                function sendSMS() {
                    const num = document.getElementById('phone').value;
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
                        data.reverse().slice(0,10).forEach(item => {
                            h.innerHTML += "<div class='log'><b>" + item.phone + "</b><br>" + item.time + "</div>";
                        });
                        if(data[0]) {
                            const last = data[0];
                            if(marker) map.removeLayer(marker);
                            marker = L.marker([last.lat, last.lng]).addTo(map).bindPopup("Target Located").openPopup();
                            map.setView([last.lat, last.lng], 15);
                        }
                    });
                }
                setInterval(updateFeed, 5000); // Refresh map every 5 seconds
                updateFeed();
            </script>
        </body>
        </html>
    `);
});

// 3. FRIEND'S TRACKING PAGE (The link they click)
app.get('/share', (req, res) => {
    res.send(`
        <body style="text-align:center; padding:50px; font-family:sans-serif;">
            <h2>Secure Connection Established</h2>
            <p>Your friend is requesting your location. Please click below to share.</p>
            <button onclick="share()" style="padding:20px; background:blue; color:white; border:none; border-radius:10px;">Share My Location</button>
            <script>
                function share() {
                    navigator.geolocation.getCurrentPosition(p => {
                        fetch('/save-loc', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude })
                        }).then(() => alert("Shared! You can close this window now."));
                    });
                }
            </script>
        </body>
    `);
});

// --- API Logic ---
app.post('/send-sms', (req, res) => {
    if (!client) return res.json({ msg: "Twilio not configured! Add your SID/Token to the code." });
    const link = "https://" + req.get('host') + "/share";
    client.messages.create({ body: "Please share your location: " + link, from: TWILIO_NUM, to: req.body.phone })
        .then(() => res.json({ msg: "SMS Sent!" }))
        .catch(e => res.json({ msg: "Error: " + e.message }));
});

app.post('/save-loc', (req, res) => {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE));
    data.push({ ...req.body, phone: "Target Phone", time: new Date().toLocaleString() });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data));
    res.sendStatus(200);
});

app.get('/get-history', (req, res) => {
    res.send(fs.readFileSync(HISTORY_FILE));
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(PORT, () => console.log('Running on port ' + PORT));